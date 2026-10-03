#!/usr/bin/env python3
"""One anonymous official TRELLIS.2 evaluation on Linux; no account or model download.

Contract: aljjang95/valorx-dungeon@f73b4449f5e33e72681b7795c46094afc65ceb08,
Tools/ProductionMCP/hosted_entry.py and hosted_trellis.py. SDK control transport
fixes are retained; this small owner runner supports Python 3.12 on Linux.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import fcntl
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import re
import signal
import struct
import time
from urllib.parse import quote, urlsplit
import uuid

import httpx
from PIL import Image

SPACE = "https://microsoft-trellis-2.hf.space"
REVISION = "ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d"
APP_HASH = "97edffac5d1c78992643551cc2d7daab6d9b3d7c0f049ddb5d9640ad11cfd4c3"
METADATA = "https://huggingface.co/api/spaces/microsoft/TRELLIS.2"
APP = "https://huggingface.co/spaces/microsoft/TRELLIS.2/raw/" + REVISION + "/app.py"
SAMPLERS = {
    "ss_guidance_strength": 7.5, "ss_guidance_rescale": 0.7,
    "ss_sampling_steps": 12, "ss_rescale_t": 5.0,
    "shape_slat_guidance_strength": 7.5, "shape_slat_guidance_rescale": 0.5,
    "shape_slat_sampling_steps": 12, "shape_slat_rescale_t": 3.0,
    "tex_slat_guidance_strength": 1.0, "tex_slat_guidance_rescale": 0.0,
    "tex_slat_sampling_steps": 12, "tex_slat_rescale_t": 3.0,
}
EXPORT = {"decimation_target": 300000, "texture_size": 2048}
SESSION_SECONDS = 300
WORK = Path("/workspace/.blade-surge-tools/trellis-citadel")
DENIED_HEADERS = {"authorization", "cookie", "x-hf-authorization", "x-ip-token", "proxy-authorization"}
# Cloud networking requires its supplied proxy and trusted CA configuration.
# HF authentication remains explicitly disabled; no provider token is loaded.
HTTP_POLICY = dict(timeout=30, follow_redirects=False, trust_env=True)


class Failure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def classify(error):
    if isinstance(error, Failure):
        return error
    message = str(error).lower()  # Classify only; never print remote messages/URLs.
    if any(x in message for x in ("quota", "429", "gpu time", "rate limit", "too many requests")):
        return Failure("quota")
    if any(x in message for x in ("401", "403", "unauthorized", "forbidden", "login required", "please log in")):
        return Failure("auth")
    if isinstance(error, (TimeoutError, concurrent.futures.TimeoutError, httpx.TimeoutException)):
        return Failure("timeout")
    if isinstance(error, (KeyboardInterrupt, concurrent.futures.CancelledError)):
        return Failure("cancelled")
    if isinstance(error, (OSError, httpx.TransportError)):
        return Failure("network")
    return Failure("remote")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_remote(url, limit=2 * 1024**2):
    if url not in {METADATA, APP, SPACE + "/config", SPACE + "/gradio_api/info"}:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "microsoft-trellis-2.hf.space"
                or not parsed.path.startswith("/gradio_api/file=/tmp/") or parsed.query or parsed.fragment):
            raise Failure("file_data")
    with httpx.stream("GET", url, headers={"User-Agent": "BladeSurge-TRELLIS-canary/1"},
                      cookies={}, verify=True, **HTTP_POLICY) as response:
        response.raise_for_status()
        if response.status_code != 200 or str(response.url) != url:
            raise Failure("network")
        chunks, length = [], 0
        for chunk in response.iter_bytes():
            length += len(chunk)
            if length > limit:
                raise Failure("file_limit")
            chunks.append(chunk)
        if not length:
            raise Failure("file_limit")
        return b"".join(chunks)


def observation():
    data = json.loads(read_remote(METADATA))
    runtime = data.get("runtime", {})
    if (data.get("id") != "microsoft/TRELLIS.2" or data.get("sha") != REVISION
            or runtime.get("sha") != REVISION or runtime.get("stage") != "RUNNING"
            or runtime.get("hardware", {}).get("current") != "zero-a10g"):
        raise Failure("revision")
    return {"source_revision": REVISION, "deployed_revision": REVISION, "stage": "RUNNING"}


def preflight():
    import gradio_client
    if gradio_client.__version__ != "2.0.0":
        raise Failure("sdk")
    before = observation()
    if digest(read_remote(APP)) != APP_HASH:
        raise Failure("app_revision")
    config = json.loads(read_remote(SPACE + "/config"))
    schema = json.loads(read_remote(SPACE + "/gradio_api/info"))
    if (config.get("version") != "6.1.0" or config.get("api_prefix") != "/gradio_api"
            or config.get("protocol") != "sse_v3" or config.get("mcp_server") is not False):
        raise Failure("schema")
    expected = {
        "/start_session": ([], []), "/preprocess_image": (["input"], ["Image"]),
        "/image_to_3d": (["image", "seed", "resolution", *SAMPLERS], ["Html"]),
        "/extract_glb": (list(EXPORT), ["Model3d", "Downloadbutton"]),
    }
    try:
        for name, (params, outputs) in expected.items():
            endpoint = schema["named_endpoints"][name]
            if ([p["parameter_name"] for p in endpoint["parameters"]] != params
                    or [r["component"] for r in endpoint["returns"]] != outputs
                    or endpoint.get("api_visibility", "public") != "public"):
                raise Failure("schema")
            for parameter in endpoint["parameters"]:
                key = parameter["parameter_name"]
                if key in SAMPLERS or key in EXPORT:
                    if parameter["parameter_default"] != {**SAMPLERS, **EXPORT}[key]:
                        raise Failure("schema")
        selected = {name: schema["named_endpoints"][name] for name in expected}
    except (KeyError, TypeError):
        raise Failure("schema") from None
    schema_hash = digest(json.dumps(selected, sort_keys=True, separators=(",", ":")).encode())
    return before, config, schema, schema_hash


def anonymous_client(config, schema):
    from gradio_client import Client, utils
    from gradio_client.client import Endpoint
    os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    class PolicyEndpoint(Endpoint):
        def control(self, kind, payload):
            if kind not in {"cancel", "reset"}:
                raise Failure("sdk")
            event = payload.get("event_id")
            if event is not None and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", event):
                raise Failure("sdk")
            if self.client.cookies or DENIED_HEADERS.intersection(k.lower() for k in self.client.headers):
                raise Failure("auth")
            try:
                response = httpx.post(SPACE + "/gradio_api/" + kind, json=payload,
                    headers={"User-Agent": "BladeSurge-TRELLIS-canary/1"},
                    cookies={}, verify=True, **HTTP_POLICY)
                response.raise_for_status()
            except BaseException as error:
                self.client.failure = classify(error).code
                raise classify(error) from None

        def make_cancel(self, helper):
            if helper is None:
                return None
            return lambda: self.control("cancel", {"fn_index": self.fn_index,
                "session_hash": self.client.session_hash, "event_id": helper.event_id})

        def _cancel_watch(self, helper):
            deadline = time.monotonic() + SESSION_SECONDS
            while True:
                time.sleep(0.05)
                with helper.lock:
                    if helper.should_cancel:
                        break
                    if helper.thread_complete or self.client._kill_heartbeat.is_set():
                        raise concurrent.futures.CancelledError()
                if time.monotonic() >= deadline:
                    self.client.failure = "timeout"
                    raise Failure("timeout")
            if helper.event_id:
                if helper.reset_url != SPACE + "/gradio_api/reset":
                    raise Failure("sdk")
                self.control("reset", {"event_id": helper.event_id})
            raise concurrent.futures.CancelledError()

        def _sse_fn_v1plus(self, helper, event_id, protocol):
            if protocol != "sse_v3":
                raise Failure("sdk")
            helper.thread_complete = False
            cancel_future = self.client.executor.submit(self._cancel_watch, helper)
            result_future = self.client.executor.submit(utils.stream_sse_v1plus,
                helper, self.client.pending_messages_per_event, event_id, protocol)
            try:
                done, _ = concurrent.futures.wait((cancel_future, result_future),
                    return_when=concurrent.futures.FIRST_COMPLETED)
                if result_future in done and not helper.should_cancel:
                    return result_future.result()
                return cancel_future.result()
            finally:
                helper.thread_complete = True
                if not result_future.done():
                    messages = self.client.pending_messages_per_event.get(event_id)
                    if messages is not None:
                        messages.append(None)

    class PinnedClient(Client):
        failure = None

        def __init__(self):
            super().__init__(SPACE, token=False, auth=None, headers=None,
                download_files=False, verbose=False, max_workers=4, ssl_verify=True,
                analytics_enabled=False, httpx_kwargs=dict(HTTP_POLICY))
            self.endpoints = {i: PolicyEndpoint(self, i, e.dependency, self.protocol)
                              for i, e in self.endpoints.items()}

        def _get_config(self):
            return copy.deepcopy(config)

        def _get_api_info(self):
            return copy.deepcopy(schema)

        def _stream_heartbeat(self):
            try:
                with httpx.stream("GET", self.heartbeat_url.format(session_hash=self.session_hash),
                    headers=self.headers, cookies={}, verify=True, **HTTP_POLICY) as response:
                    response.raise_for_status()
                    for _ in response.iter_lines():
                        if self._kill_heartbeat.is_set():
                            return
                if not self._kill_heartbeat.is_set():
                    self.failure = "network"
            except BaseException as error:
                if not self._kill_heartbeat.is_set():
                    self.failure = classify(error).code

        def stream_messages(self, protocol, session_hash):
            try:
                super().stream_messages(protocol, session_hash)
            except BaseException as error:
                self.failure = classify(error).code
                raise

    client = PinnedClient()
    if client.cookies or client.space_id is not None or DENIED_HEADERS.intersection(k.lower() for k in client.headers):
        client.close()
        raise Failure("auth")
    return client


def image_info(data, original=False):
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or not 0 < len(data) <= 16 * 1024**2:
        raise Failure("input")
    with Image.open(io.BytesIO(data)) as image:
        if (image.format != "PNG" or image.mode not in {"RGBA", "RGB"}
                or getattr(image, "n_frames", 1) != 1 or max(image.size) > 4096):
            raise Failure("input")
        image.load()
        if original:
            if image.mode != "RGBA":
                raise Failure("input_transparency")
            alpha = image.getchannel("A")
            low, high = alpha.getextrema()
            box = alpha.point(lambda a: 255 if a > 204 else 0).getbbox()
            if low != 0 or high <= 204 or box is None or min(box[2]-box[0], box[3]-box[1]) < 2:
                raise Failure("input_transparency")
        return {"sha256": digest(data), "width": image.width, "height": image.height, "mode": image.mode}


def download_file(value, suffix, limit):
    if not isinstance(value, dict) or value.get("meta", {}).get("_type") != "gradio.FileData":
        raise Failure("file_data")
    path = value.get("path", "")
    if (not isinstance(path, str) or not path.startswith("/tmp/") or not path.endswith(suffix)
            or any(p in {".", ".."} for p in path.split("/"))):
        raise Failure("file_data")
    expected = SPACE + "/gradio_api/file=" + quote(path, safe="/")
    if value.get("url") not in {None, expected, SPACE + "/gradio_api/file=" + path}:
        raise Failure("file_data")
    data = read_remote(expected, limit)
    if value.get("size") is not None and value["size"] != len(data):
        raise Failure("file_data")
    return path, data


def validate_glb(data):
    if len(data) < 28 or struct.unpack_from("<III", data) != (0x46546C67, 2, len(data)):
        raise Failure("glb")
    json_size, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A or 20 + json_size + 8 >= len(data):
        raise Failure("glb")
    document = json.loads(data[20:20 + json_size])
    if not document.get("meshes") or not document.get("materials") or not document.get("images"):
        raise Failure("glb")
    if any("uri" in item for group in ("buffers", "images") for item in document.get(group, [])):
        raise Failure("glb_external_reference")
    for mesh in document["meshes"]:
        if not mesh.get("primitives") or any("POSITION" not in p.get("attributes", {}) for p in mesh["primitives"]):
            raise Failure("glb")
    return {"meshes": len(document["meshes"]), "materials": len(document["materials"]),
            "images": len(document["images"]), "bytes": len(data), "sha256": digest(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only metadata/schema/client check; no job submission")
    parser.add_argument("--input", type=Path, help="Owner-approved single-object transparent RGBA PNG")
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    stopped = False
    def stop(signum, frame):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    client, output, state, deadline = None, None, {}, time.monotonic() + SESSION_SECONDS
    def check():
        if stopped:
            raise Failure("cancelled")
        if time.monotonic() >= deadline:
            raise Failure("timeout")
        if client is not None and client.failure:
            raise Failure(client.failure)
    def call(name, **kwargs):
        check()
        observation()
        job = client.submit(api_name=name, **kwargs)
        if name == "/image_to_3d":
            state["gpu_generation_calls"] = 1
        if name == "/extract_glb":
            state["gpu_export_calls"] = 1
        if output:
            (output / "result.json").write_text(json.dumps(state, indent=2))
        try:
            while not job.done():
                check()
                time.sleep(0.25)
            check()
            return job.result(timeout=0)
        except BaseException:
            try:
                job.cancel()  # One cancellation, no resubmission/reconnection.
            except BaseException:
                pass
            raise
    try:
        before, config, schema, schema_hash = preflight()
        client = anonymous_client(config, schema)
        if args.check:
            print(json.dumps({"status": "READ_ONLY_CHECK_PASSED", "deployment": before,
                "schema_sha256": schema_hash, "client": "gradio-client2.0.0/Linux/Python3.12",
                "auth": "anonymous", "gpu_calls": 0}))
            return 0
        if args.input is None or args.input.is_symlink() or args.input.stat().st_nlink != 1:
            raise Failure("input")
        original = args.input.read_bytes()
        info = image_info(original, original=True)
        WORK.mkdir(parents=True, exist_ok=True)
        with (WORK / "canary.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            output = WORK / str(uuid.uuid4())
            output.mkdir()
            (output / "original.png").write_bytes(original)
            state = {"status": "RUNNING", "auth": "anonymous", "input": info,
                "output_directory": str(output), "gpu_generation_calls": 0,
                "paid_account_used": False, "server_loaded_weight_revision": "UNVERIFIED"}
            file_data = lambda name: {"path": str(output / name), "meta": {"_type": "gradio.FileData"}}
            call("/start_session")
            _, processed = download_file(call("/preprocess_image", input=file_data("original.png")), ".png", 16 * 1024**2)
            image_info(processed)
            (output / "preprocessed.png").write_bytes(processed)
            if digest(args.input.read_bytes()) != info["sha256"]:
                raise Failure("input_changed")
            # Exclusive persistent marker prevents any second GPU trial for this request.
            marker = WORK / "citadel-20261003.gpu-attempt.json"
            try:
                with marker.open("x") as stream:
                    json.dump({"input_sha256": info["sha256"], "output_directory": str(output)}, stream)
            except FileExistsError:
                raise Failure("already_attempted") from None
            state["gpu_attempt_reserved"] = True
            (output / "result.json").write_text(json.dumps(state, indent=2))
            preview = call("/image_to_3d", image=file_data("preprocessed.png"), seed=42, resolution="512", **SAMPLERS)
            if not isinstance(preview, str) or not preview:
                raise Failure("preview")
            exported = call("/extract_glb", **EXPORT)
            if not isinstance(exported, (list, tuple)) or len(exported) != 2:
                raise Failure("file_data")
            first_path, mesh = download_file(exported[0], ".glb", 128 * 1024**2)
            second_path, duplicate = download_file(exported[1], ".glb", 128 * 1024**2)
            if first_path != second_path or mesh != duplicate:
                raise Failure("duplicate_export")
            glb = validate_glb(mesh)
            (output / "source.glb").write_bytes(mesh)
            after, _, _, schema_after = preflight()
            if schema_after != schema_hash or digest(args.input.read_bytes()) != info["sha256"]:
                raise Failure("input_or_schema_changed")
            state.update(status="GLB_GENERATED_REQUIRES_ART_REVIEW", glb=glb,
                model="microsoft/TRELLIS.2-4B", space={"before": before, "after": after},
                parameters={"seed": 42, "resolution": "512", **SAMPLERS, **EXPORT},
                app_sha256=APP_HASH, schema_sha256=schema_hash,
                output_license_metadata="MIT", commercial_output_review="pending",
                original_dense_mesh_available=False, pbr_volume_available=False,
                source_contract="aljjang95/valorx-dungeon@f73b4449f5e33e72681b7795c46094afc65ceb08")
            (output / "source.provenance.json").write_text(json.dumps(state, indent=2))
            (output / "result.json").write_text(json.dumps(state, indent=2))
            print(json.dumps(state))
            return 0
    except BaseException as error:
        code = classify(error).code
        state.update(status="FAILED", error=code, glb_created=bool(output and (output / "source.glb").exists()))
        if output:
            (output / "result.json").write_text(json.dumps(state, indent=2))
        print(json.dumps(state))
        return 1
    finally:
        if client:
            client.close()
            client.executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    raise SystemExit(main())

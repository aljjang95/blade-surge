package com.theluxurylord.bladesurge;

import android.app.Activity;
import android.os.CancellationSignal;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

@CapacitorPlugin(name = "BladeStore")
public class StoreBridgePlugin extends Plugin {

  private static final String CHANNEL = "googleplay";
  private static final String BILLING_VERSION = "9.1.0";
  private BillingClient billingClient;

  private String billingConfigurationError() {
    if (!CHANNEL.equals(BuildConfig.STORE_CHANNEL)) return "STORE_CHANNEL_MISMATCH";
    return validProductId(adFreeProductId()) ? null : "AD_FREE_PRODUCT_NOT_CONFIGURED";
  }

  private boolean billingReady() {
    return billingClient != null && billingClient.isReady();
  }

  private void closeBillingClient() {
    ++billingEpoch;
    BillingClient oldClient = billingClient;
    billingClient = null;
    if (oldClient != null) {
      try {
        oldClient.endConnection();
      } catch (RuntimeException ignored) {
        // 정리 실패의 SDK 원문은 로그에 남기지 않는다.
      }
    }
  }

  private void connect(PluginCall call, Runnable connected) {
    int epoch = ++billingEpoch;
    billingClient = BillingClient.newBuilder(getContext())
        .setListener((billingResult, purchases) -> callback(call, () -> {
          if (!ownsBilling(call, epoch) || !purchaseLaunched) return;
          onPurchaseUpdate(billingResult, purchases);
        }))
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build();
    billingClient.startConnection(new BillingClientStateListener() {
      @Override
      public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
        callback(call, () -> {
          if (!ownsBilling(call, epoch)) return;
          if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            completeBilling(billingFailure(billingResult));
            return;
          }
          connected.run();
        });
      }

      @Override
      public void onBillingServiceDisconnected() {
        callback(call, () -> {
          if (ownsBilling(call, epoch)) {
            completeBilling(error(purchaseLaunched ? "PURCHASE_OUTCOME_UNKNOWN" : "BILLING_DISCONNECTED")
                .put("recovery", "restorePurchases"));
          }
        });
      }
    });
  }

  private JSObject billingFailure(BillingResult billingResult) {
    int code = billingResult.getResponseCode();
    if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
      return result("cancelled").put("responseCode", code);
    }
    return error(code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED
        ? "ITEM_ALREADY_OWNED" : "BILLING_ERROR").put("responseCode", code)
        .put("recovery", "restorePurchases");
  }

  private QueryProductDetailsParams queryParams(List<String> ids) {
    List<QueryProductDetailsParams.Product> products = new ArrayList<>();
    for (String id : ids) {
      products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id)
          .setProductType(BillingClient.ProductType.INAPP).build());
    }
    return QueryProductDetailsParams.newBuilder().setProductList(products).build();
  }

  private ProductDetails.OneTimePurchaseOfferDetails permanentOffer(ProductDetails details) {
    List<ProductDetails.OneTimePurchaseOfferDetails> offers = details.getOneTimePurchaseOfferDetailsList();
    if (offers == null || offers.isEmpty()) {
      ProductDetails.OneTimePurchaseOfferDetails single = details.getOneTimePurchaseOfferDetails();
      offers = single == null ? Collections.emptyList() : Collections.singletonList(single);
    }
    ProductDetails.OneTimePurchaseOfferDetails chosen = null;
    for (ProductDetails.OneTimePurchaseOfferDetails offer : offers) {
      if (offer.getRentalDetails() != null || offer.getPreorderDetails() != null) continue;
      // 최소 영구 광고 제거 상품의 복수 오퍼는 임의로 선택하지 않는다.
      if (chosen != null) return null;
      chosen = offer;
    }
    return chosen;
  }

  @PluginMethod
  public void listProducts(PluginCall call) {
    run(call, () -> {
      List<String> ids = productIds(call);
      if (ids == null || !beginBilling(call)) return;
      connect(call, () -> {
        int epoch = billingEpoch;
        billingClient.queryProductDetailsAsync(queryParams(ids), (billingResult, queryResult) ->
            callback(call, () -> {
              if (!ownsBilling(call, epoch)) return;
              if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                completeBilling(billingFailure(billingResult));
                return;
              }
              JSArray products = new JSArray();
              Set<String> found = new HashSet<>();
              for (ProductDetails details : queryResult.getProductDetailsList()) {
                if (!ids.contains(details.getProductId())
                    || !BillingClient.ProductType.INAPP.equals(details.getProductType())) continue;
                ProductDetails.OneTimePurchaseOfferDetails offer = permanentOffer(details);
                if (offer == null) continue;
                found.add(details.getProductId());
                products.put(new JSObject().put("productId", details.getProductId())
                    .put("sku", details.getProductId()).put("name", details.getName())
                    .put("title", details.getTitle()).put("description", details.getDescription())
                    .put("productType", "inapp").put("consumable", false)
                    .put("displayAmount", offer.getFormattedPrice()).put("formattedPrice", offer.getFormattedPrice())
                    .put("priceAmountMicros", Long.toString(offer.getPriceAmountMicros()))
                    .put("currencyCode", offer.getPriceCurrencyCode()));
              }
              JSArray unavailable = new JSArray();
              for (String id : ids) {
                if (!found.contains(id)) unavailable.put(id);
              }
              completeBilling(result(unavailable.length() == 0 ? "products" : "partial")
                  .put("products", products).put("unavailableProductIds", unavailable));
            }));
      });
    });
  }

  @PluginMethod
  public void purchase(PluginCall call) {
    run(call, () -> {
      if (!purchaseInput(call) || !beginReceiptOperation(call)) return;
      String id = call.getString("productId");
      String account = call.getString("obfuscatedAccountId");
      connect(call, () -> {
        int epoch = billingEpoch;
        billingClient.queryProductDetailsAsync(queryParams(Collections.singletonList(id)),
            (billingResult, queryResult) -> callback(call, () -> {
              if (!ownsBilling(call, epoch)) return;
              if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                completeBilling(billingFailure(billingResult));
                return;
              }
              ProductDetails product = null;
              for (ProductDetails details : queryResult.getProductDetailsList()) {
                if (id.equals(details.getProductId())
                    && BillingClient.ProductType.INAPP.equals(details.getProductType())) {
                  product = details;
                  break;
                }
              }
              if (product == null) {
                completeBilling(error("PRODUCT_UNAVAILABLE"));
                return;
              }
              ProductDetails.OneTimePurchaseOfferDetails offer = permanentOffer(product);
              if (offer == null) {
                completeBilling(error("PERMANENT_OFFER_UNAVAILABLE_OR_AMBIGUOUS"));
                return;
              }
              if (!foregroundActivity()) {
                completeBilling(error("ACTIVITY_NOT_FOREGROUND"));
                return;
              }
              BillingFlowParams.ProductDetailsParams.Builder item =
                  BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product);
              String offerToken = offer.getOfferToken();
              if (offerToken != null && !offerToken.isEmpty()) item.setOfferToken(offerToken);
              BillingFlowParams params = BillingFlowParams.newBuilder()
                  .setProductDetailsParamsList(Collections.singletonList(item.build()))
                  .setObfuscatedAccountId(account).build();
              purchaseLaunched = true;
              armBillingTimeout(PURCHASE_TIMEOUT_MS);
              BillingResult launched = billingClient.launchBillingFlow(getActivity(), params);
              if (ownsBilling(call, epoch) && launched.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                completeBilling(billingFailure(launched));
              }
            }));
      });
    });
  }

  private JSObject receipt(Purchase purchase) {
    if (!receiptTransportSafe()) return error("SENSITIVE_BRIDGE_LOGGING_ENABLED");
    if (purchase.getPurchaseToken() == null || purchase.getPurchaseToken().isEmpty()) {
      return error("PURCHASE_TOKEN_MISSING");
    }
    int state = purchase.getPurchaseState();
    String status = state == Purchase.PurchaseState.PURCHASED ? "purchased"
        : state == Purchase.PurchaseState.PENDING ? "pending" : "error";
    JSObject data = result(status).put("productIds", new JSArray(purchase.getProducts()))
        .put("productId", adFreeProductId()).put("packageName", purchase.getPackageName())
        .put("purchaseState", state).put("quantity", purchase.getQuantity())
        .put("acknowledged", purchase.isAcknowledged()).put("requiresServerVerification", true)
        .put("verificationStatus", "pending").put("acknowledgement", "server");
    if ("error".equals(status)) return data.put("code", "UNKNOWN_PURCHASE_STATE");
    // 토큰과 서명은 응답으로만 전달한다. 로그/이벤트/저장소에 복사하지 않는다.
    return data.put("purchaseToken", purchase.getPurchaseToken())
        .put("signature", purchase.getSignature()).put("originalJson", purchase.getOriginalJson());
  }

  private boolean allowedReceipt(Purchase purchase) {
    return purchase != null && getContext().getPackageName().equals(purchase.getPackageName())
        && purchase.getProducts().size() == 1 && purchase.getProducts().contains(adFreeProductId())
        && purchase.getQuantity() == 1;
  }

  private void onPurchaseUpdate(BillingResult billingResult, List<Purchase> purchases) {
    if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
      completeBilling(billingFailure(billingResult));
      return;
    }
    if (purchases == null || purchases.size() != 1 || !allowedReceipt(purchases.get(0))) {
      completeBilling(error("PURCHASE_CALLBACK_MISMATCH").put("recovery", "restorePurchases"));
      return;
    }
    Purchase purchase = purchases.get(0);
    if (purchase.getAccountIdentifiers() == null
        || !billingCall.getString("obfuscatedAccountId").equals(
            purchase.getAccountIdentifiers().getObfuscatedAccountId())) {
      completeBilling(error("PURCHASE_ACCOUNT_MISMATCH").put("recovery", "restorePurchases"));
      return;
    }
    completeBilling(receipt(purchase));
  }

  @PluginMethod
  public void restorePurchases(PluginCall call) {
    run(call, () -> {
      if (!beginReceiptOperation(call)) return;
      connect(call, () -> {
        int epoch = billingEpoch;
        billingClient.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP).build(),
            (billingResult, purchases) -> callback(call, () -> {
              if (!ownsBilling(call, epoch)) return;
              if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                completeBilling(billingFailure(billingResult));
                return;
              }
              JSArray receipts = new JSArray();
              if (purchases != null) {
                for (Purchase purchase : purchases) {
                  if (allowedReceipt(purchase)) receipts.put(receipt(purchase));
                }
              }
              completeBilling(result("restored").put("purchases", receipts)
                  .put("requiresServerVerification", true));
            }));
      });
    });
  }

  private static final long AUTH_TIMEOUT_MS = 120000;
  private PluginCall authCall;
  private CancellationSignal authCancellation;
  private Runnable authTimeout;
  private int authEpoch;
  private long authStartedAt;

  private String googleWebClientId() {
    return getConfig().getString("googleWebClientId", "").trim();
  }

  private String identityConfigurationError() {
    if (!CHANNEL.equals(BuildConfig.STORE_CHANNEL)) return "STORE_CHANNEL_MISMATCH";
    if ("onestore".equals(CHANNEL) && !Boolean.TRUE.equals(
        getConfig().getConfigJSON().opt("oneStoreGoogleIdentityEnabled"))) {
      return "ONESTORE_GOOGLE_IDENTITY_DISABLED";
    }
    String clientId = googleWebClientId();
    if (clientId.isEmpty()) return "GOOGLE_WEB_CLIENT_ID_NOT_CONFIGURED";
    if (!clientId.matches("[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com")) {
      return "GOOGLE_WEB_CLIENT_ID_INVALID";
    }
    return null;
  }

  private String identityNonce() {
    byte[] bytes = new byte[32];
    new java.security.SecureRandom().nextBytes(bytes);
    return android.util.Base64.encodeToString(bytes,
        android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
  }

  private boolean ownsAuth(PluginCall call, int epoch) {
    return !destroyed && authCall == call && authEpoch == epoch;
  }

  // 로컬 claims 대조는 요청 결박만 검사한다. 서명/계정 인증은 서버가 검증한다.
  private boolean matchesIdentityRequest(String token, String audience, String nonce) {
    if (token == null || token.isEmpty() || token.length() > 16384) return false;
    String[] parts = token.split("\\.", -1);
    if (parts.length != 3) return false;
    for (String part : parts) {
      if (part.isEmpty() || !part.matches("[A-Za-z0-9_-]+")) return false;
    }
    try {
      byte[] payload = android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE);
      org.json.JSONObject claims = new org.json.JSONObject(
          new String(payload, java.nio.charset.StandardCharsets.UTF_8));
      return audience.equals(claims.opt("aud")) && nonce.equals(claims.opt("nonce"));
    } catch (org.json.JSONException | IllegalArgumentException ignored) {
      return false;
    }
  }

  @PluginMethod
  public void authenticate(PluginCall call) {
    run(call, () -> {
      String configError = identityConfigurationError();
      if (configError != null) {
        call.resolve(error(configError));
        return;
      }
      if (!receiptTransportSafe()) {
        call.resolve(error("SENSITIVE_BRIDGE_LOGGING_ENABLED"));
        return;
      }
      if (authCall != null || billingCall != null || consentCall != null
          || adLoadCall != null || adShowCall != null) {
        call.resolve(error("BUSY"));
        return;
      }
      if (!foregroundActivity()) {
        call.resolve(error("ACTIVITY_NOT_FOREGROUND"));
        return;
      }
      String audience = googleWebClientId();
      String nonce = identityNonce();
      GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(audience)
          .setNonce(nonce).build();
      GetCredentialRequest request = new GetCredentialRequest.Builder()
          .addCredentialOption(option).build();
      authCall = call;
      int epoch = ++authEpoch;
      authStartedAt = SystemClock.elapsedRealtime();
      authCancellation = new CancellationSignal();
      authTimeout = () -> {
        if (ownsAuth(call, epoch)) completeAuth(error("AUTH_TIMEOUT"));
      };
      main.postDelayed(authTimeout, AUTH_TIMEOUT_MS);
      CredentialManager manager = CredentialManager.create(getContext().getApplicationContext());
      // 사용자 호출로만 Google 로그인 UI를 연다. 이메일/원문 credential은 반환하지 않는다.
      manager.getCredentialAsync(getActivity(), request, authCancellation, command -> main.post(command),
          new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
            @Override
            public void onResult(@NonNull GetCredentialResponse response) {
              callback(call, () -> {
                if (!ownsAuth(call, epoch)) return;
                if (SystemClock.elapsedRealtime() - authStartedAt >= AUTH_TIMEOUT_MS) {
                  completeAuth(error("AUTH_TIMEOUT"));
                  return;
                }
                if (!activeActivity()) {
                  completeAuth(error("ACTIVITY_UNAVAILABLE"));
                  return;
                }
                if (!receiptTransportSafe()) {
                  completeAuth(error("SENSITIVE_BRIDGE_LOGGING_ENABLED"));
                  return;
                }
                Credential credential = response.getCredential();
                if (!(credential instanceof CustomCredential)
                    || (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())
                        && !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL.equals(credential.getType()))) {
                  completeAuth(error("UNSUPPORTED_IDENTITY_CREDENTIAL"));
                  return;
                }
                try {
                  String token = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                  if (!matchesIdentityRequest(token, audience, nonce)) {
                    completeAuth(error("GOOGLE_ID_TOKEN_REQUEST_MISMATCH"));
                    return;
                  }
                  // 토큰은 이 응답으로만 전달한다. 저장/이벤트/로그/서버 bearer로 사용하지 않는다.
                  completeAuth(result("credential_received").put("provider", "google").put("idToken", token)
                      .put("requiresServerVerification", true).put("backendAuth", false)
                      .put("oauthBindingVerified", false));
                } catch (Exception ignored) {
                  // Kotlin API에 Java throws 선언이 없어도 실제 parsing 예외는 무로그로 처리한다.
                  completeAuth(error("GOOGLE_ID_TOKEN_PARSE_FAILED"));
                }
              });
            }

            @Override
            public void onError(@NonNull GetCredentialException exception) {
              callback(call, () -> {
                if (!ownsAuth(call, epoch)) return;
                if (exception instanceof GetCredentialCancellationException) {
                  completeAuth(result("cancelled").put("code", "AUTH_CANCELLED"));
                } else if (exception instanceof NoCredentialException) {
                  completeAuth(error("NO_GOOGLE_CREDENTIAL"));
                } else {
                  completeAuth(error("AUTH_PROVIDER_ERROR"));
                }
              });
            }
          });
    });
  }

  private void completeAuth(JSObject data) {
    PluginCall owner = authCall;
    authCall = null;
    ++authEpoch;
    if (authTimeout != null) main.removeCallbacks(authTimeout);
    authTimeout = null;
    CancellationSignal cancellation = authCancellation;
    authCancellation = null;
    authStartedAt = 0;
    if (cancellation != null && !cancellation.isCanceled()) {
      try {
        cancellation.cancel();
      } catch (RuntimeException ignored) {
        // 취소 예외와 원문 credential을 기록하지 않는다.
      }
    }
    if (owner != null) owner.resolve(data);
  }

  private static final long QUERY_TIMEOUT_MS = 30000;
  private static final long PURCHASE_TIMEOUT_MS = 180000;
  private static final long AD_TIMEOUT_MS = 65000;
  private static final long AD_MAX_AGE_MS = 55 * 60 * 1000;
  private final Handler main = new Handler(Looper.getMainLooper());
  private volatile boolean destroyed;
  private PluginCall billingCall;
  private Runnable billingTimeout;
  private int billingEpoch;
  private boolean purchaseLaunched;
  private PluginCall consentCall;
  private PluginCall adLoadCall;
  private PluginCall adShowCall;
  private boolean adDisplayed;
  private Runnable adTimeout;
  private int adEpoch;
  private boolean adsInitialized;
  private ConsentInformation consentInformation;
  private InterstitialAd interstitial;
  private long adLoadedAt;

  // 광고/IAP 결과는 서버 권한이나 게임 재화를 변경하지 않는다.
  private JSObject result(String status) {
    return new JSObject().put("channel", CHANNEL).put("status", status)
        .put("verified", false).put("entitlementGranted", false);
  }

  private JSObject error(String code) {
    return result("error").put("code", code);
  }

  private boolean activeActivity() {
    Activity activity = getActivity();
    return !destroyed && activity != null && !activity.isFinishing() && !activity.isDestroyed();
  }

  private boolean foregroundActivity() {
    return activeActivity() && getActivity().getLifecycle().getCurrentState()
        .isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED);
  }

  private void settleFailure(PluginCall call, String code) {
    if (authCall == call) completeAuth(error(code));
    else if (billingCall == call) completeBilling(error(code));
    else if (consentCall == call) completeConsent(null, code);
    else if (adLoadCall == call) completeAdLoad(error(code));
    else if (adShowCall == call) completeAdShow(error(code));
    else call.resolve(error(code));
  }

  private void run(PluginCall call, Runnable action) {
    main.post(() -> {
      if (!activeActivity()) {
        settleFailure(call, "ACTIVITY_UNAVAILABLE");
        return;
      }
      try {
        action.run();
      } catch (RuntimeException ignored) {
        // 예외 원문에는 토큰/개인정보가 포함될 수 있어 기록하거나 전달하지 않는다.
        settleFailure(call, "SDK_EXCEPTION");
      }
    });
  }

  private void callback(PluginCall call, Runnable action) {
    main.post(() -> {
      if (destroyed) return;
      try {
        action.run();
      } catch (RuntimeException ignored) {
        settleFailure(call, "SDK_EXCEPTION");
      }
    });
  }

  private String adFreeProductId() {
    return "remove_ads_v1";
  }

  private boolean validProductId(String value) {
    return value != null && value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,149}");
  }

  private List<String> productIds(PluginCall call) {
    JSArray input = call.getArray("productIds");
    if (input == null || input.length() == 0 || input.length() > 20) {
      call.resolve(error("INVALID_PRODUCT_IDS"));
      return null;
    }
    if (!validProductId(adFreeProductId())) {
      call.resolve(error("AD_FREE_PRODUCT_NOT_CONFIGURED"));
      return null;
    }
    Set<String> unique = new HashSet<>();
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < input.length(); i++) {
      Object value = input.opt(i);
      if (!(value instanceof String) || !validProductId((String) value)) {
        call.resolve(error("INVALID_PRODUCT_IDS"));
        return null;
      }
      String id = (String) value;
      if (!id.equals(adFreeProductId())) {
        call.resolve(error("PRODUCT_NOT_ALLOWED"));
        return null;
      }
      if (unique.add(id)) ids.add(id);
    }
    return ids;
  }

  private boolean purchaseInput(PluginCall call) {
    String productId = call.getString("productId");
    String accountId = call.getString("obfuscatedAccountId");
    if (!validProductId(adFreeProductId())) {
      call.resolve(error("AD_FREE_PRODUCT_NOT_CONFIGURED"));
      return false;
    }
    if (!adFreeProductId().equals(productId)) {
      call.resolve(error("PRODUCT_NOT_ALLOWED"));
      return false;
    }
    // 서버가 만든 해시/HMAC만 전달한다. 원문 이메일 등의 계정 값은 허용하지 않는다.
    if (accountId == null || !accountId.matches("[A-Za-z0-9_-]{1,64}")) {
      call.resolve(error("INVALID_OBFUSCATED_ACCOUNT_ID"));
      return false;
    }
    return true;
  }

  private boolean receiptTransportSafe() {
    return getBridge() != null && !getBridge().getConfig().isLoggingEnabled();
  }

  private boolean beginReceiptOperation(PluginCall call) {
    // Capacitor debug bridge가 반환 receipt를 console에 기록하는 경로도 차단한다.
    if (!receiptTransportSafe()) {
      call.resolve(error("SENSITIVE_BRIDGE_LOGGING_ENABLED"));
      return false;
    }
    return beginBilling(call);
  }

  private boolean beginBilling(PluginCall call) {
    if (authCall != null || billingCall != null || consentCall != null || adShowCall != null) {
      call.resolve(error("BUSY"));
      return false;
    }
    String configError = billingConfigurationError();
    if (configError != null) {
      call.resolve(error(configError));
      return false;
    }
    billingCall = call;
    purchaseLaunched = false;
    armBillingTimeout(QUERY_TIMEOUT_MS);
    return true;
  }

  private boolean ownsBilling(PluginCall call, int epoch) {
    return !destroyed && billingCall == call && billingEpoch == epoch;
  }

  private void armBillingTimeout(long delay) {
    if (billingTimeout != null) main.removeCallbacks(billingTimeout);
    PluginCall owner = billingCall;
    billingTimeout = () -> {
      if (billingCall == owner && owner != null) {
        completeBilling(error(purchaseLaunched ? "PURCHASE_OUTCOME_UNKNOWN" : "BILLING_TIMEOUT")
            .put("recovery", "restorePurchases"));
      }
    };
    main.postDelayed(billingTimeout, delay);
  }

  private void completeBilling(JSObject data) {
    PluginCall owner = billingCall;
    billingCall = null;
    purchaseLaunched = false;
    if (billingTimeout != null) main.removeCallbacks(billingTimeout);
    billingTimeout = null;
    // 호출마다 연결을 닫아 이전 구매 콜백이 새 호출을 완료하지 못하게 한다.
    closeBillingClient();
    if (owner != null) owner.resolve(data);
  }

  private String manifestAppId() {
    try {
      ApplicationInfo info = getContext().getPackageManager().getApplicationInfo(
          getContext().getPackageName(), PackageManager.GET_META_DATA);
      return info.metaData == null ? "" :
          info.metaData.getString("com.google.android.gms.ads.APPLICATION_ID", "").trim();
    } catch (PackageManager.NameNotFoundException | RuntimeException ignored) {
      return "";
    }
  }

  private boolean adsConfigured() {
    String appId = manifestAppId();
    // Manifest 앱 ID와 compiled 광고 단위가 일치해야 한다. JS의 consent/configured는 읽지 않는다.
    String unit = BuildConfig.STORE_AD_UNIT_ID;
    return CHANNEL.equals(BuildConfig.STORE_CHANNEL)
        && appId.matches("ca-app-pub-[0-9]{16}~[0-9]{10}")
        && validAdUnit(unit) && appId.substring(0, appId.indexOf('~')).equals(
            unit.substring(0, unit.indexOf('/')))
        && (BuildConfig.DEBUG || !appId.startsWith("ca-app-pub-3940256099942544~"));
  }

  private boolean canRequestAds() {
    return consentInformation != null && consentInformation.canRequestAds();
  }

  private boolean privacyOptionsRequired() {
    return consentInformation != null && consentInformation.getPrivacyOptionsRequirementStatus()
        == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
  }

  @PluginMethod
  public void getCapabilities(PluginCall call) {
    run(call, () -> {
      JSArray missing = new JSArray();
      String billingError = billingConfigurationError();
      if (billingError != null) missing.put(billingError);
      String identityError = identityConfigurationError();
      if (identityError != null) missing.put(identityError);
      if (!receiptTransportSafe()) missing.put("CAPACITOR_LOGGING_MUST_BE_NONE");
      if (!adsConfigured()) missing.put("ADMOB_APP_ID_NOT_CONFIGURED");
      String unit = BuildConfig.STORE_AD_UNIT_ID;
      if (!validAdUnit(unit)) missing.put("INTERSTITIAL_UNIT_NOT_CONFIGURED");
      call.resolve(result("capabilities").put("billingSdkVersion", BILLING_VERSION)
          .put("adsSdkVersion", "25.5.0").put("umpSdkVersion", "4.0.0")
          .put("billing", billingError == null).put("billingConfigured", billingError == null)
          .put("billingConnected", billingReady()).put("backendAuth", false)
          .put("nativeSignIn", identityError == null && receiptTransportSafe())
          .put("googleIdentityConfigured", identityError == null).put("authProvider", "google")
          .put("credentialManagerVersion", "1.6.0").put("googleIdSdkVersion", "1.2.1")
          .put("oauthBindingVerified", false).put("billingActivated", false)
          .put("receiptTransportSafe", receiptTransportSafe())
          .put("nativePendingPurchases", "googleplay".equals(CHANNEL))
          .put("ads", adsConfigured()).put("canRequestAds", canRequestAds())
          .put("adAppId", manifestAppId()).put("adUnitId", unit)
          .put("privacyOptionsRequired", privacyOptionsRequired())
          .put("interstitialLoaded", interstitial != null
              && SystemClock.elapsedRealtime() - adLoadedAt <= AD_MAX_AGE_MS)
          .put("requiresServerVerification", true).put("acknowledgement", "server")
          .put("consumable", false).put("rewardedAds", false).put("missingConfiguration", missing)
          .put("methods", new JSArray(java.util.Arrays.asList("getCapabilities", "authenticate", "listProducts", "purchase",
              "restorePurchases", "requestAdConsent", "loadInterstitial", "showInterstitial"))));
    });
  }

  @PluginMethod
  public void requestAdConsent(PluginCall call) {
    run(call, () -> {
      if (!adsConfigured()) {
        call.resolve(error("ADMOB_APP_ID_NOT_CONFIGURED"));
        return;
      }
      if (authCall != null || consentCall != null || billingCall != null || adShowCall != null) {
        call.resolve(error("BUSY"));
        return;
      }
      if (!foregroundActivity()) {
        call.resolve(error("ACTIVITY_NOT_FOREGROUND"));
        return;
      }
      boolean privacyOptions = Boolean.TRUE.equals(call.getBoolean("privacyOptions", false));
      if (privacyOptions && !privacyOptionsRequired()) {
        call.resolve(error("PRIVACY_OPTIONS_NOT_REQUIRED"));
        return;
      }
      consentCall = call;
      // 동의 변경 동안 기존 로드/광고를 무효화한다.
      invalidateAds("CONSENT_CHANGED");
      if (consentInformation == null) {
        consentInformation = UserMessagingPlatform.getConsentInformation(getContext());
      }
      if (privacyOptions) {
        UserMessagingPlatform.showPrivacyOptionsForm(getActivity(),
            formError -> callback(call, () -> {
              if (consentCall == call) completeConsent(formError, null);
            }));
        return;
      }
      ConsentRequestParameters parameters = new ConsentRequestParameters.Builder()
          .setTagForUnderAgeOfConsent(false).build();
      consentInformation.requestConsentInfoUpdate(getActivity(), parameters,
          () -> callback(call, () -> {
            if (consentCall != call) return;
            if (!foregroundActivity()) {
              completeConsent(null, "ACTIVITY_UNAVAILABLE");
              return;
            }
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(getActivity(),
                formError -> callback(call, () -> {
                  if (consentCall == call) completeConsent(formError, null);
                }));
          }),
          formError -> callback(call, () -> {
            if (consentCall == call) completeConsent(formError, null);
          }));
    });
  }

  private void completeConsent(FormError formError, String code) {
    PluginCall owner = consentCall;
    consentCall = null;
    if (owner == null) return;
    JSObject data = result(formError == null && code == null ? "consent" : "error")
        .put("canRequestAds", canRequestAds()).put("privacyOptionsRequired", privacyOptionsRequired())
        .put("consentStatus", consentInformation == null ? 0 : consentInformation.getConsentStatus());
    if (formError != null) data.put("code", "UMP_ERROR").put("responseCode", formError.getErrorCode());
    if (code != null) data.put("code", code);
    owner.resolve(data);
  }

  private boolean validAdUnit(String id) {
    return id != null && id.matches("ca-app-pub-[0-9]{16}/[0-9]{10}")
        && (BuildConfig.DEBUG || !id.startsWith("ca-app-pub-3940256099942544/"));
  }

  @PluginMethod
  public void loadInterstitial(PluginCall call) {
    run(call, () -> {
      if (!adsConfigured()) {
        call.resolve(error("ADMOB_APP_ID_NOT_CONFIGURED"));
        return;
      }
      if (consentCall != null || !canRequestAds()) {
        call.resolve(error("CONSENT_REQUIRED"));
        return;
      }
      if (authCall != null || adLoadCall != null || adShowCall != null || billingCall != null) {
        call.resolve(error("BUSY"));
        return;
      }
      String unit = BuildConfig.STORE_AD_UNIT_ID;
      String suppliedUnit = call.getString("adUnitId");
      boolean permitted = suppliedUnit == null || (BuildConfig.DEBUG && suppliedUnit.equals(unit));
      if (!validAdUnit(unit) || !permitted) {
        call.resolve(error("INTERSTITIAL_UNIT_NOT_CONFIGURED"));
        return;
      }
      interstitial = null;
      adLoadCall = call;
      int epoch = ++adEpoch;
      adTimeout = () -> {
        if (adLoadCall == call && adEpoch == epoch) {
          ++adEpoch;
          completeAdLoad(error("AD_LOAD_TIMEOUT"));
        }
      };
      main.postDelayed(adTimeout, AD_TIMEOUT_MS);
      if (adsInitialized) {
        loadAd(call, epoch, unit);
      } else {
        // 초기화에서도 광고가 조회될 수 있어 UMP를 먼저 확인한다.
        if (!canRequestAds()) {
          completeAdLoad(error("CONSENT_REQUIRED"));
          return;
        }
        MobileAds.initialize(getContext(), initializationStatus -> callback(call, () -> {
          if (adLoadCall != call || adEpoch != epoch) return;
          adsInitialized = true;
          loadAd(call, epoch, unit);
        }));
      }
    });
  }

  private void loadAd(PluginCall call, int epoch, String unit) {
    if (adLoadCall != call || adEpoch != epoch) return;
    if (!activeActivity() || consentCall != null || !canRequestAds()) {
      completeAdLoad(error("CONSENT_REQUIRED"));
      return;
    }
    InterstitialAd.load(getContext(), unit, new AdRequest.Builder().build(),
        new InterstitialAdLoadCallback() {
          @Override
          public void onAdLoaded(@NonNull InterstitialAd ad) {
            callback(call, () -> {
              if (adLoadCall != call || adEpoch != epoch) return;
              if (!activeActivity() || !canRequestAds() || consentCall != null) {
                completeAdLoad(error("CONSENT_REQUIRED"));
                return;
              }
              interstitial = ad;
              adLoadedAt = SystemClock.elapsedRealtime();
              completeAdLoad(result("loaded"));
            });
          }

          @Override
          public void onAdFailedToLoad(@NonNull LoadAdError adError) {
            callback(call, () -> {
              if (adLoadCall == call && adEpoch == epoch) {
                completeAdLoad(error("AD_LOAD_FAILED").put("responseCode", adError.getCode()));
              }
            });
          }
        });
  }

  private void completeAdLoad(JSObject data) {
    PluginCall owner = adLoadCall;
    adLoadCall = null;
    if (adTimeout != null) main.removeCallbacks(adTimeout);
    adTimeout = null;
    if (owner != null) owner.resolve(data);
  }

  @PluginMethod
  public void showInterstitial(PluginCall call) {
    run(call, () -> {
      if (authCall != null || adShowCall != null || consentCall != null || billingCall != null || adLoadCall != null) {
        call.resolve(error("BUSY"));
        return;
      }
      if (!adsConfigured() || !canRequestAds()) {
        interstitial = null;
        call.resolve(error("CONSENT_REQUIRED"));
        return;
      }
      if (!foregroundActivity()) {
        call.resolve(error("ACTIVITY_NOT_FOREGROUND"));
        return;
      }
      // 전투 상태 판정은 게임 coordinator의 실제 상태기계와 함께 검증해야 한다.
      String placement = call.getString("placement");
      if (placement != null && !"postBattle".equals(placement) && !"lobby".equals(placement)) {
        call.resolve(error("UNSAFE_AD_PLACEMENT"));
        return;
      }
      if (interstitial == null || SystemClock.elapsedRealtime() - adLoadedAt > AD_MAX_AGE_MS) {
        interstitial = null;
        call.resolve(error("AD_NOT_LOADED"));
        return;
      }
      InterstitialAd ad = interstitial;
      interstitial = null;
      adShowCall = call;
      adDisplayed = false;
      ad.setFullScreenContentCallback(new FullScreenContentCallback() {
        @Override
        public void onAdShowedFullScreenContent() {
          callback(call, () -> {
            if (adShowCall == call) adDisplayed = true;
          });
        }

        @Override
        public void onAdDismissedFullScreenContent() {
          callback(call, () -> {
            if (adShowCall == call) completeAdShow(result("dismissed").put("rewardGranted", false));
          });
        }

        @Override
        public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
          callback(call, () -> {
            if (adShowCall == call) {
              completeAdShow(error("AD_SHOW_FAILED").put("responseCode", adError.getCode()));
            }
          });
        }
      });
      // 자동 재생/재로드와 전면 광고 보상은 제공하지 않는다.
      ad.show(getActivity());
    });
  }

  private void completeAdShow(JSObject data) {
    PluginCall owner = adShowCall;
    adShowCall = null;
    boolean observedShown = adDisplayed;
    adDisplayed = false;
    if (owner != null) owner.resolve(data.put("shown", observedShown).put("rewardGranted", false));
  }

  private void invalidateAds(String code) {
    ++adEpoch;
    interstitial = null;
    if (adLoadCall != null) completeAdLoad(error(code));
  }

  @Override
  protected void handleOnDestroy() {
    destroyed = true;
    Runnable cleanup = () -> {
      completeAuth(error("PLUGIN_DESTROYED"));
      completeBilling(error("PLUGIN_DESTROYED"));
      completeConsent(null, "PLUGIN_DESTROYED");
      invalidateAds("PLUGIN_DESTROYED");
      completeAdShow(error("PLUGIN_DESTROYED"));
      consentInformation = null;
    };
    if (Looper.myLooper() == Looper.getMainLooper()) cleanup.run();
    else main.post(cleanup);
  }
}


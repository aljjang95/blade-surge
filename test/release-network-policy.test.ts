import {test,expect} from 'bun:test';
import {releaseRequestPolicy} from '../tools/release-network-policy.mjs';
const origin='https://blade.tllhouse.com';
test('real integrity-protected scripts are fetched, while only owned RUM can post',()=>{
 expect(releaseRequestPolicy('https://static.cloudflareinsights.com/beacon.min.js','GET',origin)).toBe('read');
 expect(releaseRequestPolicy(origin+'/cdn-cgi/rum?','POST',origin)).toBe('telemetry');
 for(const url of [origin+'/api/party',origin+'/api/companion','https://other.example/cdn-cgi/rum'])expect(releaseRequestPolicy(url,'POST',origin)).toBe('block');
 expect(releaseRequestPolicy(origin+'/cdn-cgi/rum','DELETE',origin)).toBe('block');
});

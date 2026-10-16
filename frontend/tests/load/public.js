// k6 load test for the public, unauthenticated paths citizens hit most.
//   k6 run -e BASE_URL=https://staging.lrmis.so -e VERIFY_CODE=XXXXXXXXXXXX tests/load/public.js
// Never point it at production during office hours, and never at a real payment provider.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const CODE = __ENV.VERIFY_CODE || "AAAAAAAAAAAA";

export const options = {
  scenarios: {
    citizens: { executor: "ramping-vus", startVUs: 0, stages: [{ duration: "1m", target: 50 }, { duration: "3m", target: 200 }, { duration: "1m", target: 0 }] },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{page:landing}": ["p(95)<800"],
    "http_req_duration{page:verify}": ["p(95)<600"],
    "http_req_duration{page:tiles}": ["p(95)<500"],
    "http_req_duration{page:health}": ["p(95)<300"],
  },
};

// Tiles around central Mogadishu at street zoom.
const TILES = [[15, 20645, 16212], [15, 20646, 16212], [16, 41291, 32425], [16, 41292, 32424]];

export default function () {
  const r1 = http.get(`${BASE}/so`, { tags: { page: "landing" } });
  check(r1, { "landing 200": (r) => r.status === 200 });
  const r2 = http.get(`${BASE}/en/verify/${CODE}`, { tags: { page: "verify" } });
  check(r2, { "verify 200/404": (r) => r.status === 200 || r.status === 404 });
  const [z, x, y] = TILES[Math.floor(Math.random() * TILES.length)];
  const r3 = http.get(`${BASE}/api/tiles/neighbourhoods/${z}/${x}/${y}`, { tags: { page: "tiles" } });
  check(r3, { "tile ok": (r) => r.status === 200 || r.status === 204 });
  const r4 = http.get(`${BASE}/api/health`, { tags: { page: "health" } });
  check(r4, { "health 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}

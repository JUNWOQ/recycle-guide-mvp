const ANON_ID_KEY = "eco_check_anon_user_id_v1";

export interface ClientLogEvent {
  event:
    | "app_open"
    | "guide_result"
    | "instant_reward"
    | "verify_result"
    | "duplicate_blocked"
    | "ad_completed"
    | "coupon_exchanged"
    | "coupon_used";
  category?: string;
  itemName?: string;
  passedCount?: string;
  coins?: number;
  detail?: string;
}

function getAnonymousUserId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;

    const randomPart = Math.random().toString(36).slice(2, 8);
    const timePart = Date.now().toString(36).slice(-4);
    const newId = `u_${timePart}${randomPart}`;
    localStorage.setItem(ANON_ID_KEY, newId);
    return newId;
  } catch {
    return "u_temp";
  }
}

export function sendLog(payload: ClientLogEvent): void {
  if (typeof window === "undefined") return;
  const userId = getAnonymousUserId();

  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      ...payload,
    }),
    keepalive: true,
  }).catch(() => {
    // 로그 전송 실패가 앱 동작을 방해하지 않도록 무시
  });
}
/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useRef, useState } from "react";

// 테스트 및 시연용 하루 코인 획득 기회 (배출법 질문은 횟수 무제한)
const DEFAULT_DAILY_LIMIT = 2;
const NON_RECYCLABLE_COIN = 20;
const AD_DURATION_SECONDS = 15;
const STORAGE_KEY = "eco_check_mvp_state_v2";

type PrincipleKey = "empty" | "rinse" | "separate" | "noMix";
type DisposalCategory = "재활용" | "일반쓰레기" | "음식물쓰레기" | "특수배출" | "인식 불가";

interface PrincipleResult {
  key: PrincipleKey;
  label: string;
  passed: boolean;
  detail: string;
}

interface GuideResult {
  itemName: string;
  disposalCategory: DisposalCategory;
  detailedCategory: string;
  disposalSteps: string[];
  cautionNote: string;
  isValidWaste: boolean;
  isScreenCapture: boolean;
  summaryFeedback: string;
}

interface VerifyResult {
  itemName: string;
  isValidWaste: boolean;
  isScreenCapture: boolean;
  principles: PrincipleResult[];
  passedCount: number;
  earnedCoins: number;
  summaryFeedback: string;
  actionTip: string;
}

interface CouponProduct {
  id: string;
  brand: string;
  title: string;
  description: string;
  cost: number;
  tag: string;
}

interface OwnedCoupon {
  id: string;
  brand: string;
  title: string;
  code: string;
  issuedAt: string;
  used: boolean;
}

interface TestLogs {
  guideQueryCount: number;
  coinRewardAttempts: number;
  successCount: number;
  rejectedCount: number;
  duplicateBlockedCount: number;
  adCompletedCount: number;
  couponExchangedCount: number;
  totalCoinsEarned: number;
}

interface PersistedState {
  date: string;
  coins: number;
  remainingAttempts: number;
  usedHashes: string[];
  coupons: OwnedCoupon[];
  logs: TestLogs;
}

const COUPON_CATALOG: CouponProduct[] = [
  {
    id: "local-cafe-500",
    brand: "학교 앞 제휴 카페",
    title: "아메리카노 500원 할인 쿠폰",
    description: "텀블러 지참 시 중복 할인 가능 (시연·테스트용)",
    cost: 40,
    tag: "즉시 교환",
  },
  {
    id: "eco-store-1000",
    brand: "캠퍼스 친환경 스토어",
    title: "다회용품 1,000원 할인권",
    description: "친환경 수세미·리필 스테이션 이용권",
    cost: 80,
    tag: "인기",
  },
  {
    id: "cvs-3000",
    brand: "편의점 제휴 (예정)",
    title: "편의점 3,000원 모바일 교환권",
    description: "전국 편의점 바코드 결제 가능",
    cost: 3000,
    tag: "제휴 예정",
  },
  {
    id: "local-currency-5000",
    brand: "지자체 제휴 (예정)",
    title: "지역화폐 5,000원 전환 쿠폰",
    description: "지역 상권 어디서나 현금처럼 사용",
    cost: 5000,
    tag: "제휴 예정",
  },
];

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getInitialState(date = ""): PersistedState {
  return {
    date,
    coins: 0,
    remainingAttempts: DEFAULT_DAILY_LIMIT,
    usedHashes: [],
    coupons: [],
    logs: {
      guideQueryCount: 0,
      coinRewardAttempts: 0,
      successCount: 0,
      rejectedCount: 0,
      duplicateBlockedCount: 0,
      adCompletedCount: 0,
      couponExchangedCount: 0,
      totalCoinsEarned: 0,
    },
  };
}

function generateCouponCode(): string {
  const part1 = Math.floor(1000 + Math.random() * 9000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `ECO-${part1}-${part2}`;
}

function getCategoryStyle(category: DisposalCategory) {
  switch (category) {
    case "재활용":
      return {
        badge: "bg-emerald-600 text-white",
        box: "bg-emerald-50 border-emerald-200",
        subText: "text-emerald-800",
      };
    case "일반쓰레기":
      return {
        badge: "bg-slate-700 text-white",
        box: "bg-slate-100 border-slate-300",
        subText: "text-slate-700",
      };
    case "음식물쓰레기":
      return {
        badge: "bg-amber-600 text-white",
        box: "bg-amber-50 border-amber-200",
        subText: "text-amber-800",
      };
    case "특수배출":
      return {
        badge: "bg-violet-600 text-white",
        box: "bg-violet-50 border-violet-200",
        subText: "text-violet-800",
      };
    default:
      return {
        badge: "bg-rose-600 text-white",
        box: "bg-rose-50 border-rose-200",
        subText: "text-rose-800",
      };
  }
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const bytes = new Uint8Array(buffer);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}-${file.size}`;
}

function compressImage(file: File): Promise<{
  previewDataUrl: string;
  base64: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const maxDimension = 1024;
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("이미지 캔버스를 초기화할 수 없습니다.");
        }
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = "image/jpeg";
        const previewDataUrl = canvas.toDataURL(mimeType, 0.8);
        const base64 = previewDataUrl.split(",")[1] || "";

        URL.revokeObjectURL(objectUrl);
        resolve({ previewDataUrl, base64, mimeType });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지 파일을 읽을 수 없습니다."));
    };

    img.src = objectUrl;
  });
}

export default function HomePage() {
  const [appState, setAppState] = useState<PersistedState>(() => getInitialState());
  const [isLoaded, setIsLoaded] = useState(false);

  // 1단계 (배출법 확인용 사진) 상태
  const [guidePreviewUrl, setGuidePreviewUrl] = useState<string | null>(null);
  const [guideBase64, setGuideBase64] = useState<string | null>(null);
  const [guideMimeType, setGuideMimeType] = useState<string>("image/jpeg");
  const [guideHash, setGuideHash] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [isAnalyzingGuide, setIsAnalyzingGuide] = useState(false);
  const [guideResult, setGuideResult] = useState<GuideResult | null>(null);
  const [instantRewardMessage, setInstantRewardMessage] = useState<string | null>(null);

  // 2단계 (재활용품 분리수거 완료 인증 사진) 상태
  const [verifyPreviewUrl, setVerifyPreviewUrl] = useState<string | null>(null);
  const [verifyBase64, setVerifyBase64] = useState<string | null>(null);
  const [verifyMimeType, setVerifyMimeType] = useState<string>("image/jpeg");
  const [verifyHash, setVerifyHash] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isAnalyzingVerify, setIsAnalyzingVerify] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  // 모달 상태
  const [showAdModal, setShowAdModal] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(AD_DURATION_SECONDS);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletTab, setWalletTab] = useState<"exchange" | "coupons">("exchange");
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [showStatsModal, setShowStatsModal] = useState(false);

  // 로고 5회 연속 탭 감지
  const logoTapCountRef = useRef(0);
  const logoTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 파일 입력 Ref (1단계용 / 2단계 완료인증용)
  const guideCameraRef = useRef<HTMLInputElement | null>(null);
  const guideFileRef = useRef<HTMLInputElement | null>(null);
  const verifyCameraRef = useRef<HTMLInputElement | null>(null);
  const verifyFileRef = useRef<HTMLInputElement | null>(null);

  // localStorage 불러오기
  useEffect(() => {
    const today = getTodayString();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedState;
        const safeCoupons = Array.isArray(parsed.coupons) ? parsed.coupons : [];
        if (parsed.date !== today) {
          setAppState({
            ...parsed,
            date: today,
            remainingAttempts: DEFAULT_DAILY_LIMIT,
            coupons: safeCoupons,
          });
        } else {
          setAppState({
            ...parsed,
            coupons: safeCoupons,
          });
        }
      } else {
        setAppState(getInitialState(today));
      }
    } catch {
      setAppState(getInitialState(today));
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // 상태 저장
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch {
      // 저장 실패 무시
    }
  }, [appState, isLoaded]);

  // 15초 모의 광고 카운트다운
  useEffect(() => {
    if (!showAdModal || adSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setAdSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [showAdModal, adSecondsLeft]);

  const handleLogoTap = () => {
    logoTapCountRef.current += 1;
    if (logoTapTimerRef.current) {
      clearTimeout(logoTapTimerRef.current);
    }
    if (logoTapCountRef.current >= 5) {
      logoTapCountRef.current = 0;
      setShowStatsModal(true);
      return;
    }
    logoTapTimerRef.current = setTimeout(() => {
      logoTapCountRef.current = 0;
    }, 1500);
  };

  // 전체 흐름 초기화 (새 쓰레기 찍기)
  const handleResetFlow = () => {
    setGuidePreviewUrl(null);
    setGuideBase64(null);
    setGuideHash(null);
    setGuideError(null);
    setGuideResult(null);
    setInstantRewardMessage(null);

    setVerifyPreviewUrl(null);
    setVerifyBase64(null);
    setVerifyHash(null);
    setVerifyError(null);
    setVerifyResult(null);
  };

  // 1단계 사진 선택
  const handleGuideFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setGuideResult(null);
    setGuideError(null);
    setInstantRewardMessage(null);
    setVerifyPreviewUrl(null);
    setVerifyBase64(null);
    setVerifyHash(null);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const [hash, compressed] = await Promise.all([
        computeFileHash(file),
        compressImage(file),
      ]);
      setGuideHash(hash);
      setGuidePreviewUrl(compressed.previewDataUrl);
      setGuideBase64(compressed.base64);
      setGuideMimeType(compressed.mimeType);
    } catch {
      setGuideError("사진을 불러오지 못했습니다. 다른 사진으로 다시 시도해 주세요.");
    }
    e.target.value = "";
  };

  // 1단계 AI 배출법 분석 (코인 기회가 0이어도 항상 가능!)
  const handleAnalyzeGuide = async () => {
    if (!guideBase64 || !guideHash || isAnalyzingGuide) return;

    setIsAnalyzingGuide(true);
    setGuideError(null);
    setInstantRewardMessage(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "guide",
          imageBase64: guideBase64,
          mimeType: guideMimeType,
        }),
      });

      const data = (await response.json()) as GuideResult & { error?: string };

      if (!response.ok) {
        setGuideError(data.error || "AI 분석 중 오류가 발생했습니다. 다시 시도해 주세요.");
        return;
      }

      setGuideResult(data);

      // 비재활용(일반/음식물/특수배출) & 코인 기회 남음 → 바로 코인 지급 및 기회 차감
      const isNonRecyclable =
        data.isValidWaste && data.disposalCategory !== "재활용";

      if (isNonRecyclable && appState.remainingAttempts > 0) {
        const isDuplicate = appState.usedHashes.includes(guideHash);

        if (isDuplicate) {
          setInstantRewardMessage(
            "배출법은 확인했지만, 이미 리워드를 받은 동일한 사진이라 코인은 지급되지 않습니다."
          );
          setAppState((prev) => ({
            ...prev,
            logs: {
              ...prev.logs,
              guideQueryCount: prev.logs.guideQueryCount + 1,
              duplicateBlockedCount: prev.logs.duplicateBlockedCount + 1,
            },
          }));
        } else {
          setInstantRewardMessage(
            `${data.disposalCategory} 확인 완료! 분리 전·후 촬영 없이 바로 +${NON_RECYCLABLE_COIN}코인이 지급되었습니다.`
          );
          setAppState((prev) => ({
            ...prev,
            coins: prev.coins + NON_RECYCLABLE_COIN,
            remainingAttempts: Math.max(0, prev.remainingAttempts - 1),
            usedHashes: [...prev.usedHashes, guideHash],
            logs: {
              ...prev.logs,
              guideQueryCount: prev.logs.guideQueryCount + 1,
              coinRewardAttempts: prev.logs.coinRewardAttempts + 1,
              successCount: prev.logs.successCount + 1,
              totalCoinsEarned: prev.logs.totalCoinsEarned + NON_RECYCLABLE_COIN,
            },
          }));
        }
      } else {
        // 재활용품(2단계 대기) 또는 코인 기회 0회(가이드만 제공) 또는 인식 불가
        setAppState((prev) => ({
          ...prev,
          logs: {
            ...prev.logs,
            guideQueryCount: prev.logs.guideQueryCount + 1,
            rejectedCount: prev.logs.rejectedCount + (data.isValidWaste ? 0 : 1),
          },
        }));
      }
    } catch {
      setGuideError("네트워크 연결이 불안정합니다. 인터넷 상태를 확인 후 다시 시도해 주세요.");
    } finally {
      setIsAnalyzingGuide(false);
    }
  };

  // 2단계(재활용 분리수거 완료 사진) 선택
  const handleVerifyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVerifyResult(null);
    setVerifyError(null);

    try {
      const [hash, compressed] = await Promise.all([
        computeFileHash(file),
        compressImage(file),
      ]);
      setVerifyHash(hash);
      setVerifyPreviewUrl(compressed.previewDataUrl);
      setVerifyBase64(compressed.base64);
      setVerifyMimeType(compressed.mimeType);
    } catch {
      setVerifyError("완료 사진을 불러오지 못했습니다. 다시 시도해 주세요.");
    }
    e.target.value = "";
  };

  // 2단계 재활용 완료 사진 평가 & 차등 코인 지급
  const handleAnalyzeVerify = async () => {
    if (!verifyBase64 || !verifyHash || isAnalyzingVerify) return;
    if (appState.remainingAttempts <= 0) {
      setVerifyError("오늘 코인 획득 기회를 모두 사용했습니다. 광고를 보고 기회를 추가해 주세요.");
      return;
    }

    // 1단계와 완전히 동일한 사진이거나 이미 인증한 사진 차단
    if (verifyHash === guideHash) {
      setVerifyError(
        "분리수거 전 사진과 똑같은 사진입니다. 안내대로 정리한 뒤 새로 촬영해 주세요."
      );
      setAppState((prev) => ({
        ...prev,
        logs: {
          ...prev.logs,
          duplicateBlockedCount: prev.logs.duplicateBlockedCount + 1,
        },
      }));
      return;
    }

    if (appState.usedHashes.includes(verifyHash)) {
      setVerifyError("이미 리워드 인증에 사용된 사진입니다. 새로운 완료 사진을 촬영해 주세요.");
      setAppState((prev) => ({
        ...prev,
        logs: {
          ...prev.logs,
          duplicateBlockedCount: prev.logs.duplicateBlockedCount + 1,
        },
      }));
      return;
    }

    setIsAnalyzingVerify(true);
    setVerifyError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "verify",
          imageBase64: verifyBase64,
          mimeType: verifyMimeType,
          expectedItemName: guideResult?.itemName,
        }),
      });

      const data = (await response.json()) as VerifyResult & { error?: string };

      if (!response.ok) {
        setVerifyError(data.error || "완료 사진 평가 중 오류가 발생했습니다. 다시 시도해 주세요.");
        return;
      }

      setVerifyResult(data);

      setAppState((prev) => {
        const isSuccess = data.earnedCoins > 0;
        return {
          ...prev,
          coins: prev.coins + data.earnedCoins,
          remainingAttempts: Math.max(0, prev.remainingAttempts - 1),
          usedHashes: isSuccess ? [...prev.usedHashes, verifyHash] : prev.usedHashes,
          logs: {
            ...prev.logs,
            coinRewardAttempts: prev.logs.coinRewardAttempts + 1,
            successCount: prev.logs.successCount + (isSuccess ? 1 : 0),
            rejectedCount: prev.logs.rejectedCount + (isSuccess ? 0 : 1),
            totalCoinsEarned: prev.logs.totalCoinsEarned + data.earnedCoins,
          },
        };
      });
    } catch {
      setVerifyError("네트워크 연결이 불안정합니다. 인터넷 상태를 확인 후 다시 시도해 주세요.");
    } finally {
      setIsAnalyzingVerify(false);
    }
  };

  // 광고 모달 열기 및 완료
  const handleOpenAdModal = () => {
    setAdSecondsLeft(AD_DURATION_SECONDS);
    setShowAdModal(true);
  };

  const handleCompleteAd = () => {
    if (adSecondsLeft > 0) return;
    setShowAdModal(false);
    setAppState((prev) => ({
      ...prev,
      remainingAttempts: prev.remainingAttempts + 1,
      logs: {
        ...prev.logs,
        adCompletedCount: prev.logs.adCompletedCount + 1,
      },
    }));
  };

  // 쿠폰 교환하기
  const handleExchangeCoupon = (product: CouponProduct) => {
    if (appState.coins < product.cost) {
      setWalletNotice(`코인이 ${product.cost - appState.coins}C 부족합니다.`);
      return;
    }

    const newCoupon: OwnedCoupon = {
      id: `${product.id}-${Date.now()}`,
      brand: product.brand,
      title: product.title,
      code: generateCouponCode(),
      issuedAt: getTodayString(),
      used: false,
    };

    setAppState((prev) => ({
      ...prev,
      coins: prev.coins - product.cost,
      coupons: [newCoupon, ...prev.coupons],
      logs: {
        ...prev.logs,
        couponExchangedCount: prev.logs.couponExchangedCount + 1,
      },
    }));

    setWalletNotice(`'${product.title}'이(가) 쿠폰함에 발급되었습니다!`);
    setWalletTab("coupons");
  };

  // 쿠폰 사용 완료 처리
  const handleUseCoupon = (couponId: string) => {
    setAppState((prev) => ({
      ...prev,
      coupons: prev.coupons.map((c) => (c.id === couponId ? { ...c, used: true } : c)),
    }));
  };

  const handleResetAllData = () => {
    const fresh = getInitialState(getTodayString());
    setAppState(fresh);
    handleResetFlow();
    setShowStatsModal(false);
  };

  const unusedCouponCount = appState.coupons.filter((c) => !c.used).length;
  const categoryStyle = guideResult ? getCategoryStyle(guideResult.disposalCategory) : null;

  return (
    <div className="min-h-screen bg-slate-100 flex justify-center">
      <main className="w-full max-w-md min-h-screen bg-white shadow-sm flex flex-col justify-between">
        <div>
          {/* 상단 헤더 */}
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-emerald-100 px-4 py-3.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleLogoTap}
              className="flex items-center gap-2 text-left select-none active:opacity-75"
              aria-label="에코체크 로고"
            >
              <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 12a8 8 0 0114.93-4M20 12a8 8 0 01-14.93 4m14.93-4h-3m-13 0h3"
                  />
                </svg>
              </span>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-tight">에코체크</h1>
                <p className="text-[11px] text-emerald-700 font-medium">AI 분리배출 가이드</p>
              </div>
            </button>

            <div className="flex items-center gap-1.5">
              {/* 보유 코인 버튼 */}
              <button
                type="button"
                onClick={() => {
                  setWalletNotice(null);
                  setWalletTab("exchange");
                  setShowWalletModal(true);
                }}
                className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-full transition"
              >
                <span className="w-4 h-4 rounded-full bg-amber-400 text-amber-950 text-[10px] font-extrabold flex items-center justify-center">
                  C
                </span>
                <span className="text-xs font-bold text-emerald-950">{appState.coins.toLocaleString()}</span>
              </button>

              {/* 쿠폰함 버튼 */}
              <button
                type="button"
                onClick={() => {
                  setWalletNotice(null);
                  setWalletTab("coupons");
                  setShowWalletModal(true);
                }}
                className="relative flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1.5 rounded-full text-xs font-bold transition"
              >
                <span>쿠폰함</span>
                {unusedCouponCount > 0 && (
                  <span className="bg-emerald-400 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">
                    {unusedCouponCount}
                  </span>
                )}
              </button>
            </div>
          </header>

          {/* 상태 요약 바 (배출법 무제한 + 코인 기회만 표시) */}
          <section className="px-5 pt-4">
            <div className="bg-emerald-50/80 border border-emerald-100 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-emerald-800">오늘 남은 코인 획득 기회</p>
                  <p className="text-2xl font-extrabold text-emerald-950 mt-0.5">
                    {appState.remainingAttempts}
                    <span className="text-sm font-semibold text-emerald-700 ml-1">/ {DEFAULT_DAILY_LIMIT}회</span>
                  </p>
                </div>
                <div className="text-right">
                  <span className="inline-block text-[11px] font-bold bg-white text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full">
                    배출법 확인 무제한
                  </span>
                  <p className="text-[11px] text-slate-500 mt-1">코인 기회만 차감돼요</p>
                </div>
              </div>

              {appState.remainingAttempts <= 0 && (
                <div className="pt-2 border-t border-emerald-200/70 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-amber-900 font-medium">
                    코인 기회는 다 썼지만 배출법 확인은 계속 무료예요!
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAdModal}
                    className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
                  >
                    광고 보고 +1회
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* 메인 영역 */}
          <section className="px-5 py-4 space-y-4">
            {/* 숨겨진 파일 입력 (1단계 가이드용 / 2단계 완료인증용) */}
            <input
              ref={guideCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleGuideFileChange}
              className="hidden"
            />
            <input
              ref={guideFileRef}
              type="file"
              accept="image/*"
              onChange={handleGuideFileChange}
              className="hidden"
            />
            <input
              ref={verifyCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleVerifyFileChange}
              className="hidden"
            />
            <input
              ref={verifyFileRef}
              type="file"
              accept="image/*"
              onChange={handleVerifyFileChange}
              className="hidden"
            />

            {/* 1단계: 쓰레기 사진 촬영 (코인 기회가 0이어도 항상 열려 있음) */}
            {!guidePreviewUrl ? (
              <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-6 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <span className="inline-block text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full mb-1.5">
                    STEP 1 · 쓰레기 확인
                  </span>
                  <h2 className="text-base font-bold text-slate-900">어떻게 버릴지 헷갈리는 쓰레기를 찍어주세요</h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    AI가 일반쓰레기·재활용 여부를 바로 알려드립니다.
                    {appState.remainingAttempts > 0 ? (
                      <>
                        <br />
                        분리배출까지 완료하면 코인 리워드도 받을 수 있어요!
                      </>
                    ) : (
                      <>
                        <br />
                        (현재 코인 기회 소진 상태 · 배출 방법 안내만 제공됩니다)
                      </>
                    )}
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => guideCameraRef.current?.click()}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition active:scale-[0.99]"
                  >
                    쓰레기 사진 찍기
                  </button>
                  <button
                    type="button"
                    onClick={() => guideFileRef.current?.click()}
                    className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-medium text-xs transition"
                  >
                    PC 시연용 파일 선택
                  </button>
                </div>
              </div>
            ) : (
              /* 1단계 사진 선택 후 미리보기 */
              <div className="space-y-3">
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 aspect-[4/3]">
                  <img src={guidePreviewUrl} alt="쓰레기 사진 미리보기" className="w-full h-full object-contain" />
                  <span className="absolute top-3 left-3 bg-black/65 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                    1단계 · 배출 전 사진
                  </span>
                  <button
                    type="button"
                    onClick={handleResetFlow}
                    disabled={isAnalyzingGuide || isAnalyzingVerify}
                    className="absolute top-3 right-3 bg-black/65 hover:bg-black/80 text-white text-xs font-semibold px-3 py-1.5 rounded-full"
                  >
                    처음으로
                  </button>
                </div>

                {guideError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-800 font-medium">
                    ⚠️ {guideError}
                  </div>
                )}

                {!guideResult && (
                  <button
                    type="button"
                    onClick={handleAnalyzeGuide}
                    disabled={isAnalyzingGuide}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold text-sm shadow-sm transition flex items-center justify-center gap-2"
                  >
                    {isAnalyzingGuide ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        AI가 품목 분류 및 배출 방법 분석 중...
                      </>
                    ) : (
                      "AI 분리수거 방법 확인하기"
                    )}
                  </button>
                )}
              </div>
            )}

            {/* 1단계 결과 카드: 품목 및 배출 가이드 */}
            {guideResult && categoryStyle && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className={`p-4 border-b ${categoryStyle.box}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${categoryStyle.badge}`}>
                      {guideResult.disposalCategory}
                    </span>
                    <span className={`text-xs font-bold ${categoryStyle.subText}`}>
                      · {guideResult.detailedCategory}
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-900 mt-1.5">{guideResult.itemName}</h3>
                  <p className="text-xs text-slate-700 mt-1">{guideResult.summaryFeedback}</p>
                </div>

                <div className="p-4 space-y-4">
                  {/* 단계별 배출 방법 */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-4 rounded-full bg-emerald-600 inline-block" />
                      이렇게 분리배출하세요
                    </h4>
                    <ol className="space-y-2">
                      {guideResult.disposalSteps.map((step, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2.5 bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-xs text-slate-800 leading-relaxed"
                        >
                          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span>{step.replace(/^\d+단계:\s*/, "")}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {guideResult.cautionNote && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950">
                      <p className="font-bold text-amber-800 mb-0.5">헷갈리기 쉬운 포인트</p>
                      <p className="leading-relaxed">{guideResult.cautionNote}</p>
                    </div>
                  )}

                  {/* 분기 A: 일반/음식물/특수배출 즉시 코인 지급 메시지 */}
                  {instantRewardMessage && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 font-semibold">
                      🎉 {instantRewardMessage}
                    </div>
                  )}

                  {/* 분기 B: 인식 불가 / 비재활용 마무리 / 코인 기회 0회 안내 */}
                  {(!guideResult.isValidWaste ||
                    guideResult.disposalCategory !== "재활용" ||
                    (appState.remainingAttempts <= 0 && !verifyResult)) && (
                    <div className="space-y-2 pt-1">
                      {guideResult.isValidWaste &&
                        appState.remainingAttempts <= 0 &&
                        !instantRewardMessage && (
                          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                            <p className="text-xs text-slate-600">
                              오늘 코인 획득 기회를 모두 사용해 배출 방법만 안내해 드렸습니다.
                            </p>
                            <button
                              type="button"
                              onClick={handleOpenAdModal}
                              className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition"
                            >
                              15초 광고 보고 코인 기회 +1회 추가하기
                            </button>
                          </div>
                        )}

                      <button
                        type="button"
                        onClick={handleResetFlow}
                        className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition"
                      >
                        다른 쓰레기 확인하기
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2단계(재활용품 + 코인 기회 남음): 분리수거 완료 사진 촬영 및 평가 */}
            {guideResult &&
              guideResult.isValidWaste &&
              guideResult.disposalCategory === "재활용" &&
              (appState.remainingAttempts > 0 || verifyResult) && (
                <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/40 p-4 space-y-4">
                  <div>
                    <span className="inline-block text-[11px] font-extrabold bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">
                      STEP 2 · 완료 인증 & 코인 받기
                    </span>
                    <h3 className="text-sm font-extrabold text-slate-900 mt-1.5">
                      안내대로 분리수거한 사진을 한 번 더 찍어주세요!
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      비우기·헹구기·분리 상태를 평가해 최대 40코인을 드립니다.
                    </p>
                  </div>

                  {!verifyPreviewUrl ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => verifyCameraRef.current?.click()}
                        className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition"
                      >
                        분리수거 완료 사진 찍기
                      </button>
                      <button
                        type="button"
                        onClick={() => verifyFileRef.current?.click()}
                        className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-medium text-xs transition"
                      >
                        PC 시연용 완료 사진 선택
                      </button>
                      <button
                        type="button"
                        onClick={handleResetFlow}
                        className="w-full py-2 text-slate-500 hover:text-slate-700 text-xs font-medium"
                      >
                        지금은 배출법만 볼게요 (코인 기회 차감 안 함)
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative rounded-xl overflow-hidden border border-emerald-200 bg-slate-900 aspect-[4/3]">
                        <img
                          src={verifyPreviewUrl}
                          alt="분리수거 완료 사진 미리보기"
                          className="w-full h-full object-contain"
                        />
                        <span className="absolute top-2.5 left-2.5 bg-emerald-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                          2단계 · 분리 완료 사진
                        </span>
                        {!verifyResult && (
                          <button
                            type="button"
                            onClick={() => {
                              setVerifyPreviewUrl(null);
                              setVerifyBase64(null);
                              setVerifyHash(null);
                              setVerifyError(null);
                            }}
                            disabled={isAnalyzingVerify}
                            className="absolute top-2.5 right-2.5 bg-black/65 text-white text-xs font-semibold px-3 py-1 rounded-full"
                          >
                            다시 찍기
                          </button>
                        )}
                      </div>

                      {verifyError && (
                        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-medium">
                          ⚠️ {verifyError}
                        </div>
                      )}

                      {!verifyResult && (
                        <button
                          type="button"
                          onClick={handleAnalyzeVerify}
                          disabled={isAnalyzingVerify}
                          className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold text-sm shadow-sm transition flex items-center justify-center gap-2"
                        >
                          {isAnalyzingVerify ? (
                            <>
                              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              AI가 분리배출 상태 평가 중...
                            </>
                          ) : (
                            "완료 사진 평가받고 코인 받기"
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 2단계 완료 평가 결과 카드 */}
                  {verifyResult && (
                    <div
                      className={`rounded-2xl border p-4 space-y-4 ${
                        verifyResult.earnedCoins > 0
                          ? "bg-white border-emerald-200 shadow-sm"
                          : "bg-rose-50/70 border-rose-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span
                            className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                              verifyResult.earnedCoins === 40
                                ? "bg-emerald-100 text-emerald-800"
                                : verifyResult.earnedCoins > 0
                                ? "bg-amber-100 text-amber-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {verifyResult.earnedCoins === 40
                              ? "완벽 분리배출"
                              : verifyResult.earnedCoins > 0
                              ? `부분 통과 (${verifyResult.passedCount}/4)`
                              : verifyResult.isScreenCapture
                              ? "화면 재촬영 감지"
                              : "인증 반려"}
                          </span>
                          <h4 className="text-base font-bold text-slate-900 mt-1">{verifyResult.itemName}</h4>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-slate-500">획득 코인</p>
                          <p
                            className={`text-xl font-extrabold ${
                              verifyResult.earnedCoins > 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            +{verifyResult.earnedCoins} 코인
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {verifyResult.principles.map((item) => (
                          <div
                            key={item.key}
                            className={`flex items-start gap-2.5 p-2.5 rounded-xl text-xs ${
                              item.passed ? "bg-emerald-50/70" : "bg-rose-50/80"
                            }`}
                          >
                            <span
                              className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] ${
                                item.passed ? "bg-emerald-600 text-white" : "bg-rose-500 text-white"
                              }`}
                            >
                              {item.passed ? "O" : "X"}
                            </span>
                            <div>
                              <p className="font-bold text-slate-900">{item.label}</p>
                              <p className="text-slate-600 mt-0.5">{item.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
                        <p className="text-xs font-bold text-slate-800">{verifyResult.summaryFeedback}</p>
                        <p className="text-xs text-emerald-700 font-medium">💡 {verifyResult.actionTip}</p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setWalletNotice(null);
                            setWalletTab("exchange");
                            setShowWalletModal(true);
                          }}
                          className="flex-1 py-3 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-xs transition"
                        >
                          쿠폰 교환하기
                        </button>
                        <button
                          type="button"
                          onClick={handleResetFlow}
                          className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition"
                        >
                          다른 쓰레기 확인
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

            {/* 리워드 기준 안내 */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800">리워드 지급 기준</h3>
                <span className="text-[11px] text-emerald-700 font-medium">배출법 질문은 무제한 무료</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="bg-white rounded-lg p-2 border border-emerald-200">
                  <p className="text-[10px] text-slate-500">재활용 4/4</p>
                  <p className="text-xs font-extrabold text-emerald-700 mt-0.5">40C</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <p className="text-[10px] text-slate-500">재활용 3/4</p>
                  <p className="text-xs font-extrabold text-slate-800 mt-0.5">25C</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <p className="text-[10px] text-slate-500">재활용 2/4</p>
                  <p className="text-xs font-extrabold text-slate-800 mt-0.5">10C</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <p className="text-[10px] text-slate-500">일반·음식물</p>
                  <p className="text-xs font-extrabold text-slate-700 mt-0.5">20C</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 하단 배너 광고 슬롯 */}
        <footer className="px-5 pb-5 pt-2">
          <div className="rounded-xl bg-gradient-to-r from-emerald-800 to-teal-700 text-white p-3.5 flex items-center justify-between gap-3">
            <div>
              <span className="inline-block text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">
                AD · 친환경 제휴
              </span>
              <p className="text-xs font-bold mt-1">학교 앞 제로웨이스트 카페 · 텀블러 500원 할인</p>
              <p className="text-[11px] text-emerald-100">지역 소상공인·친환경 브랜드 배너 슬롯</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setWalletNotice(null);
                setWalletTab("exchange");
                setShowWalletModal(true);
              }}
              className="shrink-0 text-xs font-bold bg-white text-emerald-900 px-2.5 py-1.5 rounded-lg"
            >
              쿠폰
            </button>
          </div>
        </footer>
      </main>

      {/* 15초 모의 보상형 광고 모달 */}
      {showAdModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5">
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-xl">
            <div className="bg-emerald-900 text-white px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-bold">보상형 친환경 파트너 광고</span>
              <span className="text-xs font-extrabold bg-emerald-700 px-2.5 py-1 rounded-full">
                {adSecondsLeft > 0 ? `${adSecondsLeft}초 남음` : "시청 완료"}
              </span>
            </div>

            <div className="p-6 text-center space-y-4">
              <div className="w-full h-36 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-100 border border-emerald-200 flex flex-col items-center justify-center p-4">
                <p className="text-xs font-bold text-emerald-700">ECO PARTNER CAMPAIGN</p>
                <p className="text-lg font-extrabold text-slate-900 mt-1">지구를 지키는 생분해 텀블러</p>
                <p className="text-xs text-slate-600 mt-1">올바른 분리배출이 더 깨끗한 캠퍼스를 만듭니다.</p>
              </div>

              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-600 h-full transition-all duration-1000"
                  style={{
                    width: `${((AD_DURATION_SECONDS - adSecondsLeft) / AD_DURATION_SECONDS) * 100}%`,
                  }}
                />
              </div>

              <button
                type="button"
                onClick={handleCompleteAd}
                disabled={adSecondsLeft > 0}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold text-sm transition"
              >
                {adSecondsLeft > 0
                  ? `${adSecondsLeft}초 후 코인 기회 +1회 지급`
                  : "보상 받고 코인 기회 +1회 충전하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 코인 교환소 & 내 쿠폰함 모달 */}
      {showWalletModal && (
        <div className="fixed inset-0 z-40 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm max-h-[85vh] bg-white rounded-2xl flex flex-col overflow-hidden shadow-xl">
            {/* 모달 헤더 */}
            <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">리워드 교환소 · 쿠폰함</h2>
                <p className="text-xs text-emerald-700 font-semibold mt-0.5">
                  내 보유 코인: {appState.coins.toLocaleString()}C
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWalletModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold px-2 py-1"
              >
                닫기
              </button>
            </div>

            {/* 탭 선택 */}
            <div className="grid grid-cols-2 p-2 bg-slate-100 mx-5 mt-3 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => {
                  setWalletTab("exchange");
                  setWalletNotice(null);
                }}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  walletTab === "exchange"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                쿠폰 교환소
              </button>
              <button
                type="button"
                onClick={() => {
                  setWalletTab("coupons");
                  setWalletNotice(null);
                }}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  walletTab === "coupons"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                내 쿠폰함 ({unusedCouponCount})
              </button>
            </div>

            {walletNotice && (
              <div className="mx-5 mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 font-semibold">
                {walletNotice}
              </div>
            )}

            {/* 탭 내용 */}
            <div className="p-5 overflow-y-auto space-y-2.5 flex-1">
              {walletTab === "exchange" ? (
                COUPON_CATALOG.map((item) => {
                  const canAfford = appState.coins >= item.cost;
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 p-3.5 space-y-2.5 bg-white"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                              {item.tag}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-500">{item.brand}</span>
                          </div>
                          <p className="text-sm font-bold text-slate-900 mt-1">{item.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                        <span className="text-sm font-extrabold text-emerald-700">
                          {item.cost.toLocaleString()} 코인
                        </span>
                        <button
                          type="button"
                          onClick={() => handleExchangeCoupon(item)}
                          disabled={!canAfford}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                            canAfford
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-slate-100 text-slate-400 cursor-not-allowed"
                          }`}
                        >
                          {canAfford ? "교환하기" : "코인 부족"}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : appState.coupons.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <p className="text-sm font-bold text-slate-700">보유 중인 쿠폰이 아직 없어요</p>
                  <p className="text-xs text-slate-500">
                    분리배출로 코인을 모아 교환소에서 쿠폰으로 바꿔보세요!
                  </p>
                  <button
                    type="button"
                    onClick={() => setWalletTab("exchange")}
                    className="mt-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
                  >
                    쿠폰 교환소 보러가기
                  </button>
                </div>
              ) : (
                appState.coupons.map((coupon) => (
                  <div
                    key={coupon.id}
                    className={`rounded-xl border p-3.5 space-y-3 ${
                      coupon.used
                        ? "bg-slate-50 border-slate-200 opacity-60"
                        : "bg-white border-emerald-200 shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold text-emerald-700">{coupon.brand}</p>
                        <p className="text-sm font-bold text-slate-900 mt-0.5">{coupon.title}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">발급일: {coupon.issuedAt}</p>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          coupon.used
                            ? "bg-slate-200 text-slate-600"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {coupon.used ? "사용 완료" : "사용 가능"}
                      </span>
                    </div>

                    {/* 모의 바코드 영역 */}
                    <div className="rounded-lg bg-slate-50 border border-slate-200 py-2.5 px-3 text-center">
                      <div
                        className="h-8 w-full mx-auto opacity-80"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(90deg, #0f172a 0px, #0f172a 2px, transparent 2px, transparent 5px, #0f172a 5px, #0f172a 6px, transparent 6px, transparent 9px)",
                        }}
                      />
                      <p className="text-xs font-mono font-bold text-slate-700 tracking-widest mt-1.5">
                        {coupon.code}
                      </p>
                    </div>

                    {!coupon.used && (
                      <button
                        type="button"
                        onClick={() => handleUseCoupon(coupon.id)}
                        className="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
                      >
                        매장 직원 확인 · 사용 완료 처리
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 숨겨진 발표용 테스트 통계 모달 (상단 로고 5회 연속 탭) */}
      {showStatsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-5">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">발표용 테스트 로그</h2>
              <button
                type="button"
                onClick={() => setShowStatsModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                닫기
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-slate-500">배출법 질문 횟수</p>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">
                  {appState.logs.guideQueryCount}회
                </p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-emerald-700">코인 지급 성공</p>
                <p className="text-lg font-extrabold text-emerald-900 mt-0.5">
                  {appState.logs.successCount}회
                </p>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                <p className="text-rose-700">반려 / 중복 차단</p>
                <p className="text-lg font-extrabold text-rose-900 mt-0.5">
                  {appState.logs.rejectedCount} / {appState.logs.duplicateBlockedCount}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-amber-800">광고 / 쿠폰 교환</p>
                <p className="text-lg font-extrabold text-amber-950 mt-0.5">
                  {appState.logs.adCompletedCount} / {appState.logs.couponExchangedCount}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 text-white text-xs">
              <span>누적 지급 코인</span>
              <span className="font-extrabold text-amber-300">
                {appState.logs.totalCoinsEarned.toLocaleString()} 코인
              </span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetAllData}
                className="flex-1 py-2.5 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-bold"
              >
                전체 초기화
              </button>
              <button
                type="button"
                onClick={() => setShowStatsModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
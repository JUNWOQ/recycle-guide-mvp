/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useRef, useState } from "react";

// 테스트 및 시연용 하루 기본 인증 횟수 (실제 서비스 정책: 3~5회)
const DEFAULT_DAILY_LIMIT = 2;
const AD_DURATION_SECONDS = 15;
const STORAGE_KEY = "eco_check_mvp_state_v1";

type PrincipleKey = "empty" | "rinse" | "separate" | "noMix";
type MockMode = "perfect" | "partial" | "rejected";

interface PrincipleResult {
  key: PrincipleKey;
  label: string;
  passed: boolean;
  detail: string;
}

interface EvaluationResult {
  itemName: string;
  isValidWaste: boolean;
  isScreenCapture: boolean;
  principles: PrincipleResult[];
  passedCount: number;
  earnedCoins: number;
  summaryFeedback: string;
  actionTip: string;
}

interface TestLogs {
  totalAttempts: number;
  successCount: number;
  rejectedCount: number;
  duplicateBlockedCount: number;
  adCompletedCount: number;
  totalCoinsEarned: number;
}

interface PersistedState {
  date: string;
  coins: number;
  remainingAttempts: number;
  usedHashes: string[];
  logs: TestLogs;
}

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
    logs: {
      totalAttempts: 0,
      successCount: 0,
      rejectedCount: 0,
      duplicateBlockedCount: 0,
      adCompletedCount: 0,
      totalCoinsEarned: 0,
    },
  };
}

// 이미지 중복 업로드 차단을 위한 SHA-256 해시 계산 (비HTTPS 환경 폴백 포함)
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

// 1단계 목업(가짜 AI) 평가 결과 생성기
function getMockEvaluation(mode: MockMode): EvaluationResult {
  if (mode === "perfect") {
    return {
      itemName: "투명 페트병",
      isValidWaste: true,
      isScreenCapture: false,
      principles: [
        { key: "empty", label: "비운다", passed: true, detail: "내부 액체가 완전히 비워져 있습니다." },
        { key: "rinse", label: "헹군다", passed: true, detail: "이물질 없이 깨끗하게 헹궈졌습니다." },
        { key: "separate", label: "분리한다", passed: true, detail: "비닐 라벨과 뚜껑이 깔끔하게 분리되었습니다." },
        { key: "noMix", label: "섞지 않는다", passed: true, detail: "투명 페트병 단독 배출 상태가 양호합니다." },
      ],
      passedCount: 4,
      earnedCoins: 40,
      summaryFeedback: "환경부 분리배출 4대 원칙을 모두 완벽하게 지켰습니다!",
      actionTip: "부피를 줄여 찌그러뜨려 배출하면 수거 효율이 더 높아집니다.",
    };
  }

  if (mode === "partial") {
    return {
      itemName: "투명 페트병 (라벨 미제거)",
      isValidWaste: true,
      isScreenCapture: false,
      principles: [
        { key: "empty", label: "비운다", passed: true, detail: "내용물이 잘 비워져 있습니다." },
        { key: "rinse", label: "헹군다", passed: true, detail: "내부 오염이 거의 보이지 않습니다." },
        { key: "separate", label: "분리한다", passed: false, detail: "외부 비닐 라벨이 아직 붙어 있습니다." },
        { key: "noMix", label: "섞지 않는다", passed: true, detail: "다른 재질과 섞이지 않았습니다." },
      ],
      passedCount: 3,
      earnedCoins: 25,
      summaryFeedback: "3가지 원칙을 충족했어요! 한 가지만 보완하면 최고 보상을 받을 수 있습니다.",
      actionTip: "페트병 라벨을 완전히 떼어내면 다음 인증에서 40코인을 받을 수 있어요!",
    };
  }

  return {
    itemName: "인식 불가 / 부정 인증 감지",
    isValidWaste: false,
    isScreenCapture: true,
    principles: [
      { key: "empty", label: "비운다", passed: false, detail: "실제 분리배출 대상이 확인되지 않습니다." },
      { key: "rinse", label: "헹군다", passed: false, detail: "판독 불가" },
      { key: "separate", label: "분리한다", passed: false, detail: "판독 불가" },
      { key: "noMix", label: "섞지 않는다", passed: false, detail: "판독 불가" },
    ],
    passedCount: 0,
    earnedCoins: 0,
    summaryFeedback: "모니터·스마트폰 화면 재촬영 또는 분리배출 쓰레기가 아닌 사진으로 판단되었습니다.",
    actionTip: "실제 분리배출한 쓰레기를 카메라로 직접 촬영해 주세요.",
  };
}

export default function HomePage() {
  const [appState, setAppState] = useState<PersistedState>(getInitialState);
  const [isLoaded, setIsLoaded] = useState(false);

  // 이미지 및 평가 상태
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);

  // 1단계 테스트용 시뮬레이션 모드
  const [mockMode, setMockMode] = useState<MockMode>("perfect");

  // 모달 상태
  const [showAdModal, setShowAdModal] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(AD_DURATION_SECONDS);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);

  // 로고 5회 연속 탭 감지용
  const logoTapCountRef = useRef(0);
  const logoTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // localStorage 불러오기
  useEffect(() => {
    const today = getTodayString();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedState;
        if (parsed.date !== today) {
          setAppState({
            ...parsed,
            date: today,
            remainingAttempts: DEFAULT_DAILY_LIMIT,
          });
        } else {
          setAppState(parsed);
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

  // 상태 변경 시 localStorage 저장
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
    if (!showAdModal) return;
    if (adSecondsLeft <= 0) return;

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResult(null);
    setDuplicateError(null);

    const hash = await computeFileHash(file);
    setCurrentHash(hash);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPreviewUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);

    // 같은 파일을 다시 선택해도 onChange가 트리거되도록 초기화
    e.target.value = "";
  };

  const handleAnalyze = () => {
    if (!previewUrl || !currentHash || isAnalyzing) return;

    if (appState.remainingAttempts <= 0) {
      return;
    }

    // 동일 이미지 해시 재사용 차단
    if (appState.usedHashes.includes(currentHash)) {
      setDuplicateError("이미 인증에 사용된 동일한 사진입니다. 새로운 분리배출 사진을 촬영해 주세요.");
      setAppState((prev) => ({
        ...prev,
        logs: {
          ...prev.logs,
          duplicateBlockedCount: prev.logs.duplicateBlockedCount + 1,
        },
      }));
      return;
    }

    setIsAnalyzing(true);
    setDuplicateError(null);

    // 1단계: 실제 API 호출 느낌을 주는 1.2초 지연 후 목업 평가 반환
    setTimeout(() => {
      const evaluation = getMockEvaluation(mockMode);
      setResult(evaluation);
      setIsAnalyzing(false);

      setAppState((prev) => {
        const isSuccess = evaluation.earnedCoins > 0;
        return {
          ...prev,
          coins: prev.coins + evaluation.earnedCoins,
          remainingAttempts: Math.max(0, prev.remainingAttempts - 1),
          usedHashes: isSuccess ? [...prev.usedHashes, currentHash] : prev.usedHashes,
          logs: {
            ...prev.logs,
            totalAttempts: prev.logs.totalAttempts + 1,
            successCount: prev.logs.successCount + (isSuccess ? 1 : 0),
            rejectedCount: prev.logs.rejectedCount + (isSuccess ? 0 : 1),
            totalCoinsEarned: prev.logs.totalCoinsEarned + evaluation.earnedCoins,
          },
        };
      });
    }, 1200);
  };

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

  const handleResetPhoto = () => {
    setPreviewUrl(null);
    setCurrentHash(null);
    setResult(null);
    setDuplicateError(null);
  };

  const handleResetAllData = () => {
    const fresh = getInitialState(getTodayString());
    setAppState(fresh);
    handleResetPhoto();
    setShowStatsModal(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex justify-center">
      <main className="w-full max-w-md min-h-screen bg-white shadow-sm flex flex-col justify-between">
        <div>
          {/* 상단 헤더 */}
          <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-emerald-100 px-5 py-4 flex items-center justify-between">
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
                <p className="text-[11px] text-emerald-700 font-medium">AI 분리배출 리워드</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowExchangeModal(true)}
              className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-full transition"
            >
              <span className="w-5 h-5 rounded-full bg-amber-400 text-amber-950 text-[11px] font-extrabold flex items-center justify-center">
                C
              </span>
              <span className="text-sm font-bold text-emerald-950">{appState.coins.toLocaleString()}</span>
              <span className="text-xs text-emerald-700 font-medium">코인</span>
            </button>
          </header>

          {/* 상태 요약 바 */}
          <section className="px-5 pt-4">
            <div className="bg-emerald-50/80 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-emerald-800">오늘 남은 인증 횟수</p>
                <p className="text-2xl font-extrabold text-emerald-950 mt-0.5">
                  {appState.remainingAttempts}
                  <span className="text-sm font-semibold text-emerald-700 ml-1">/ {DEFAULT_DAILY_LIMIT}회</span>
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block text-[11px] font-semibold bg-white text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full">
                  환경부 4대 원칙 기준
                </span>
                <p className="text-[11px] text-slate-500 mt-1">최대 40코인 차등 지급</p>
              </div>
            </div>
          </section>

          {/* 1단계 목업 시뮬레이션 선택기 (2단계 실제 AI 연결 시 제거 예정) */}
          <section className="px-5 pt-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-slate-500 mb-2">
                [1단계 시연·테스트용] 가짜 AI 결과 선택
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setMockMode("perfect")}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    mockMode === "perfect"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200"
                  }`}
                >
                  완벽 통과
                </button>
                <button
                  type="button"
                  onClick={() => setMockMode("partial")}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    mockMode === "partial"
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200"
                  }`}
                >
                  라벨 미제거
                </button>
                <button
                  type="button"
                  onClick={() => setMockMode("rejected")}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                    mockMode === "rejected"
                      ? "bg-rose-600 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200"
                  }`}
                >
                  어뷰징 반려
                </button>
              </div>
            </div>
          </section>

          {/* 메인 인증 영역 */}
          <section className="px-5 py-4 space-y-4">
            {/* 숨겨진 파일 입력 */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* 횟수 소진 시 보상형 광고 카드 */}
            {appState.remainingAttempts <= 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/70 p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">오늘의 무료 인증을 모두 썼어요</h2>
                  <p className="text-xs text-slate-600 mt-1">
                    15초 친환경 파트너 광고를 시청하면 인증 횟수 1회가 즉시 추가됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenAdModal}
                  className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition active:scale-[0.99]"
                >
                  15초 광고 보고 1회 추가하기
                </button>
              </div>
            ) : !previewUrl ? (
              /* 사진 미선택 상태 */
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
                  <h2 className="text-base font-bold text-slate-900">분리배출한 쓰레기를 찍어주세요</h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    비우기 · 헹구기 · 분리하기 · 섞지 않기 기준을
                    <br />
                    AI가 바로 평가하고 코인을 드립니다.
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition active:scale-[0.99]"
                  >
                    분리배출 사진 찍기
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-medium text-xs transition"
                  >
                    PC 시연용 파일 선택
                  </button>
                </div>
              </div>
            ) : (
              /* 사진 선택 완료 상태 */
              <div className="space-y-3">
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 aspect-[4/3]">
                  <img src={previewUrl} alt="분리배출 인증 미리보기" className="w-full h-full object-contain" />
                  <button
                    type="button"
                    onClick={handleResetPhoto}
                    className="absolute top-3 right-3 bg-black/65 hover:bg-black/80 text-white text-xs font-semibold px-3 py-1.5 rounded-full"
                  >
                    다시 찍기
                  </button>
                </div>

                {duplicateError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-800 font-medium">
                    ⚠️ {duplicateError}
                  </div>
                )}

                {!result && (
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold text-sm shadow-sm transition flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        AI가 환경부 4대 원칙 평가 중...
                      </>
                    ) : (
                      "AI 평가 받고 코인 받기"
                    )}
                  </button>
                )}
              </div>
            )}

            {/* AI 평가 결과 카드 */}
            {result && (
              <div
                className={`rounded-2xl border p-4 space-y-4 ${
                  result.earnedCoins > 0
                    ? "bg-white border-emerald-200 shadow-sm"
                    : "bg-rose-50/50 border-rose-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span
                      className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        result.earnedCoins === 40
                          ? "bg-emerald-100 text-emerald-800"
                          : result.earnedCoins > 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {result.earnedCoins === 40
                        ? "완벽 배출"
                        : result.earnedCoins > 0
                        ? "부분 통과"
                        : "인증 반려"}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{result.itemName}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">획득 리워드</p>
                    <p
                      className={`text-xl font-extrabold ${
                        result.earnedCoins > 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      +{result.earnedCoins} 코인
                    </p>
                  </div>
                </div>

                {/* 환경부 4대 원칙 체크리스트 */}
                <div className="space-y-2">
                  {result.principles.map((item) => (
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

                {/* AI 종합 피드백 */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
                  <p className="text-xs font-bold text-slate-800">{result.summaryFeedback}</p>
                  <p className="text-xs text-emerald-700 font-medium">💡 {result.actionTip}</p>
                </div>

                <button
                  type="button"
                  onClick={handleResetPhoto}
                  className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition"
                >
                  다른 쓰레기 인증하기
                </button>
              </div>
            )}

            {/* 리워드 기준 안내 */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-4">
              <h3 className="text-xs font-bold text-slate-800 mb-2">차등 코인 리워드 기준</h3>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="bg-white rounded-lg p-2 border border-emerald-200">
                  <p className="text-[11px] text-slate-500">4개 통과</p>
                  <p className="text-xs font-extrabold text-emerald-700 mt-0.5">40C</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <p className="text-[11px] text-slate-500">3개 통과</p>
                  <p className="text-xs font-extrabold text-slate-800 mt-0.5">25C</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <p className="text-[11px] text-slate-500">2개 통과</p>
                  <p className="text-xs font-extrabold text-slate-800 mt-0.5">10C</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-slate-200">
                  <p className="text-[11px] text-slate-500">1개 이하</p>
                  <p className="text-xs font-extrabold text-rose-600 mt-0.5">0C</p>
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
            <span className="shrink-0 text-xs font-bold bg-white text-emerald-900 px-2.5 py-1.5 rounded-lg">
              보기
            </span>
          </div>
        </footer>
      </main>

      {/* 15초 모의 보상형 광고 모달 (중간 닫기 불가) */}
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
                  ? `${adSecondsLeft}초 후 인증 횟수 +1회 지급`
                  : "보상 받고 인증 1회 추가하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 코인 교환소 미리보기 모달 */}
      {showExchangeModal && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-5">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">코인 교환소 (출시 예정)</h2>
              <button
                type="button"
                onClick={() => setShowExchangeModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                닫기
              </button>
            </div>

            <div className="bg-emerald-50 rounded-xl p-3 flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-900">내 보유 코인</span>
              <span className="text-base font-extrabold text-emerald-700">
                {appState.coins.toLocaleString()} 코인
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
                <div>
                  <p className="font-bold text-slate-900">편의점 3,000원 모바일 교환권</p>
                  <p className="text-slate-500 mt-0.5">제휴 단계 도입 예정</p>
                </div>
                <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">3,000C</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
                <div>
                  <p className="font-bold text-slate-900">지역화폐 5,000원 전환</p>
                  <p className="text-slate-500 mt-0.5">지자체 제휴 단계 도입 예정</p>
                </div>
                <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">5,000C</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowExchangeModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold"
            >
              확인
            </button>
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
                <p className="text-slate-500">총 인증 시도</p>
                <p className="text-lg font-extrabold text-slate-900 mt-0.5">{appState.logs.totalAttempts}회</p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-emerald-700">인증 통과</p>
                <p className="text-lg font-extrabold text-emerald-900 mt-0.5">{appState.logs.successCount}회</p>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                <p className="text-rose-700">반려 / 중복 차단</p>
                <p className="text-lg font-extrabold text-rose-900 mt-0.5">
                  {appState.logs.rejectedCount} / {appState.logs.duplicateBlockedCount}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-amber-800">광고 시청 완료</p>
                <p className="text-lg font-extrabold text-amber-950 mt-0.5">{appState.logs.adCompletedCount}회</p>
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
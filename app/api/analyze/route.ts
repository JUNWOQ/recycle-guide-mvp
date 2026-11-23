import { NextResponse } from "next/server";

type PrincipleKey = "empty" | "rinse" | "separate" | "noMix";
type DisposalCategory = "재활용" | "일반쓰레기" | "음식물쓰레기" | "특수배출" | "인식 불가";
type AnalyzeMode = "guide" | "verify";

interface PrincipleResult {
  key: PrincipleKey;
  label: string;
  passed: boolean;
  detail: string;
}

interface GuideRawResponse {
  itemName?: string;
  disposalCategory?: string;
  detailedCategory?: string;
  disposalSteps?: string[];
  cautionNote?: string;
  isValidWaste?: boolean;
  isScreenCapture?: boolean;
  summaryFeedback?: string;
}

interface VerifyRawResponse {
  itemName?: string;
  isValidWaste?: boolean;
  isScreenCapture?: boolean;
  principles?: {
    empty?: { passed?: boolean; detail?: string };
    rinse?: { passed?: boolean; detail?: string };
    separate?: { passed?: boolean; detail?: string };
    noMix?: { passed?: boolean; detail?: string };
  };
  summaryFeedback?: string;
  actionTip?: string;
}

const GUIDE_PROMPT = `
당신은 분리배출에 서툰 대한민국 1인 가구(자취생)를 돕는 친절하고 정확한 AI 분리배출 가이드입니다.
사용자가 버리기 전 찍은 사진을 보고 ① 이 쓰레기가 무엇인지 ② 어디에 버려야 하는지(재활용/일반쓰레기/음식물쓰레기/특수배출) ③ 어떻게 처리해서 버려야 하는지 단계별로 알려주세요.

[어뷰징 및 예외 판별]
1. 컴퓨터 모니터, 노트북, 스마트폰 화면을 다시 촬영한 사진(픽셀 격자, 베젤, 화면 반사광 등)이면 isScreenCapture를 true, disposalCategory를 "인식 불가"로 설정하세요.
2. 쓰레기나 버릴 물건이 보이지 않고 사람 얼굴, 풍경, 정상 사용 중인 가전·가구 등이면 isValidWaste를 false, disposalCategory를 "인식 불가"로 설정하세요.

[분류 기준 (disposalCategory는 반드시 아래 5개 중 하나)]
- "재활용": 투명 페트병, 유색 플라스틱, 알루미늄/철 캔, 유리병, 깨끗한 종이·택배 상자, 깨끗한 비닐류 등
- "일반쓰레기": 오염이 심해 씻기 어려운 배달 용기, 코팅 종이컵, 영수증(감열지), 빨대, 칫솔, 깨진 유리, 치킨 뼈/달걀 껍데기 등
- "음식물쓰레기": 동물이 먹을 수 있는 남은 음식물, 부드러운 과일 껍질(사과·바나나 등)
- "특수배출": 폐건전지, 폐형광등, 폐의약품, 소형 폐가전, 대형폐기물
- "인식 불가": 쓰레기가 아니거나 화면 재촬영인 경우

반드시 아래 JSON 형식으로만 한국어로 응답하세요.
{
  "itemName": "구체적인 쓰레기 품목명 (예: 투명 페트병, 영수증, 일회용 커피컵, 택배 상자)",
  "disposalCategory": "재활용" | "일반쓰레기" | "음식물쓰레기" | "특수배출" | "인식 불가",
  "detailedCategory": "세부 배출함/방식 (예: 투명 페트병 전용함, 종량제 봉투, 캔류, 폐건전지 수거함)",
  "disposalSteps": [
    "1단계: 1인 가구가 바로 따라할 수 있는 구체적 행동 1문장",
    "2단계: 구체적 행동 1문장",
    "3단계: 최종 버리는 곳 안내 1문장"
  ],
  "cautionNote": "자취생이 가장 헷갈리기 쉬운 주의사항 1문장",
  "isValidWaste": true 또는 false,
  "isScreenCapture": true 또는 false,
  "summaryFeedback": "품목과 배출 방법 핵심 요약 1문장"
}
`.trim();

function buildVerifyPrompt(expectedItemName?: string): string {
  const itemHint = expectedItemName
    ? `참고: 사용자는 직전 단계에서 "${expectedItemName}"의 분리배출 방법을 안내받고, 실제 분리수거를 마친 사진을 올렸습니다.`
    : "";

  return `
당신은 대한민국 환경부 분리배출 4대 원칙(비운다, 헹군다, 분리한다, 섞지 않는다)에 따라 사용자가 분리수거를 마친 사진을 엄격하고 공정하게 평가하는 AI 심사관입니다.
${itemHint}

[어뷰징 판별 규칙]
1. 컴퓨터 모니터, 노트북, 스마트폰 화면을 다시 촬영한 사진이면 isScreenCapture를 true로 설정하세요.
2. 분리배출 대상 쓰레기가 보이지 않거나 일반 사물/사람/풍경이면 isValidWaste를 false로 설정하세요.
3. isScreenCapture가 true이거나 isValidWaste가 false이면 4대 원칙 모두 passed를 false로 설정하세요.

[4대 원칙 평가 기준]
- empty (비운다): 용기 내부에 음료·음식물·내용물이 완전히 비워졌는지 평가
- rinse (헹군다): 용기 안팎에 눈에 띄는 이물질이나 오염이 깨끗이 헹궈졌는지 평가 (종이/택배 상자 등 세척 불필요 품목은 오염 없으면 통과)
- separate (분리한다): 페트병 라벨/뚜껑 제거, 상자 테이프·송장 제거 등 다른 재질이 분리되었는지 평가
- noMix (섞지 않는다): 다른 재질의 쓰레기가 섞이지 않고 단독 분류되었는지 평가

반드시 아래 JSON 형식으로만 한국어로 응답하세요.
{
  "itemName": "평가한 재활용 품목명",
  "isValidWaste": true 또는 false,
  "isScreenCapture": true 또는 false,
  "principles": {
    "empty": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" },
    "rinse": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" },
    "separate": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" },
    "noMix": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" }
  },
  "summaryFeedback": "분리배출 완료 상태에 대한 전체 평가 1문장",
  "actionTip": "더 완벽하게 분리배출하기 위한 구체적인 팁 1문장"
}
`.trim();
}

const ALLOWED_CATEGORIES: DisposalCategory[] = [
  "재활용",
  "일반쓰레기",
  "음식물쓰레기",
  "특수배출",
  "인식 불가",
];

function normalizeCategory(raw?: string): DisposalCategory {
  if (raw && ALLOWED_CATEGORIES.includes(raw as DisposalCategory)) {
    return raw as DisposalCategory;
  }
  return "일반쓰레기";
}

function calculateVerifyCoins(passedCount: number, isValid: boolean): number {
  if (!isValid) return 0;
  if (passedCount >= 4) return 40;
  if (passedCount === 3) return 25;
  if (passedCount === 2) return 10;
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 503/429 오류 발생 시 안정적인 예비 모델로 자동 전환하며 재시도
async function callGeminiWithFallback(
  apiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string
): Promise<{ text?: string; status: number; errorMessage?: string }> {
  const candidates = Array.from(
    new Set([
      process.env.GEMINI_MODEL || "gemini-2.5-flash",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.5-flash-lite",
    ])
  );

  let lastStatus = 502;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      });

      lastStatus = res.status;

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          return { text: rawText, status: 200 };
        }
      } else {
        const errText = await res.text();
        console.warn(`Gemini model ${model} failed (${res.status}):`, errText.slice(0, 200));
        // 503(서버 혼잡), 429(한도), 404(모델 미지원)일 경우 다음 모델로 즉시 전환
        if (res.status === 503 || res.status === 429 || res.status === 404) {
          await sleep(400);
          continue;
        }
        return {
          status: res.status,
          errorMessage: `AI 분석 요청에 실패했습니다. (상태 코드: ${res.status})`,
        };
      }
    } catch (err) {
      console.warn(`Gemini model ${model} network error:`, err);
      await sleep(400);
    }
  }

  if (lastStatus === 503) {
    return {
      status: 503,
      errorMessage: "현재 AI 서버가 일시적으로 혼잡합니다. 5초 뒤 다시 눌러 주세요.",
    };
  }
  if (lastStatus === 429) {
    return {
      status: 429,
      errorMessage: "AI 요청 한도를 잠시 초과했습니다. 10초 뒤 다시 시도해 주세요.",
    };
  }
  return {
    status: lastStatus,
    errorMessage: `AI 분석에 실패했습니다. 잠시 후 다시 시도해 주세요. (상태 코드: ${lastStatus})`,
  };
}

function cleanJsonText(rawText: string): string {
  return rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      imageBase64?: string;
      mimeType?: string;
      mode?: AnalyzeMode;
      expectedItemName?: string;
    };

    if (!body.imageBase64 || !body.mimeType) {
      return NextResponse.json(
        { error: "분석할 이미지 데이터가 비어 있습니다." },
        { status: 400 }
      );
    }

    const mode: AnalyzeMode = body.mode === "verify" ? "verify" : "guide";
    const prompt = mode === "verify" ? buildVerifyPrompt(body.expectedItemName) : GUIDE_PROMPT;

    const aiResponse = await callGeminiWithFallback(
      apiKey,
      prompt,
      body.imageBase64,
      body.mimeType
    );

    if (!aiResponse.text) {
      return NextResponse.json(
        { error: aiResponse.errorMessage || "AI 응답을 받아오지 못했습니다." },
        { status: aiResponse.status === 200 ? 502 : aiResponse.status }
      );
    }

    const cleaned = cleanJsonText(aiResponse.text);

    // 1단계: 품목 분류 및 배출 방법 가이드 모드
    if (mode === "guide") {
      const parsed = JSON.parse(cleaned) as GuideRawResponse;
      const isScreenCapture = Boolean(parsed.isScreenCapture);
      const isValidWaste = Boolean(parsed.isValidWaste) && !isScreenCapture;
      const disposalCategory: DisposalCategory = isValidWaste
        ? normalizeCategory(parsed.disposalCategory)
        : "인식 불가";

      const disposalSteps =
        Array.isArray(parsed.disposalSteps) && parsed.disposalSteps.length > 0
          ? parsed.disposalSteps.filter((s) => typeof s === "string" && s.trim().length > 0)
          : isValidWaste
          ? ["안내된 분류 기준에 맞춰 전용 배출함이나 종량제 봉투에 버려 주세요."]
          : ["실제 버릴 쓰레기를 카메라로 직접 촬영해 주세요."];

      return NextResponse.json({
        mode: "guide",
        itemName: parsed.itemName || (isValidWaste ? "분리배출 품목" : "인식 불가"),
        disposalCategory,
        detailedCategory:
          parsed.detailedCategory || (isValidWaste ? disposalCategory : "인식 불가"),
        disposalSteps,
        cautionNote: parsed.cautionNote || "",
        isValidWaste,
        isScreenCapture,
        summaryFeedback:
          parsed.summaryFeedback ||
          (isValidWaste
            ? `${disposalCategory} 품목으로 분류되었습니다.`
            : "실제 쓰레기 사진이 아니거나 화면 재촬영으로 판단되었습니다."),
      });
    }

    // 2단계: 재활용품 분리수거 완료 상태 평가 모드
    const parsed = JSON.parse(cleaned) as VerifyRawResponse;
    const isScreenCapture = Boolean(parsed.isScreenCapture);
    const isValidWaste = Boolean(parsed.isValidWaste) && !isScreenCapture;

    const principles: PrincipleResult[] = [
      {
        key: "empty",
        label: "비운다",
        passed: isValidWaste && Boolean(parsed.principles?.empty?.passed),
        detail: parsed.principles?.empty?.detail || "배출 상태를 확인했습니다.",
      },
      {
        key: "rinse",
        label: "헹군다",
        passed: isValidWaste && Boolean(parsed.principles?.rinse?.passed),
        detail: parsed.principles?.rinse?.detail || "배출 상태를 확인했습니다.",
      },
      {
        key: "separate",
        label: "분리한다",
        passed: isValidWaste && Boolean(parsed.principles?.separate?.passed),
        detail: parsed.principles?.separate?.detail || "배출 상태를 확인했습니다.",
      },
      {
        key: "noMix",
        label: "섞지 않는다",
        passed: isValidWaste && Boolean(parsed.principles?.noMix?.passed),
        detail: parsed.principles?.noMix?.detail || "배출 상태를 확인했습니다.",
      },
    ];

    const passedCount = principles.filter((p) => p.passed).length;
    const earnedCoins = calculateVerifyCoins(passedCount, isValidWaste);

    return NextResponse.json({
      mode: "verify",
      itemName: parsed.itemName || body.expectedItemName || "재활용 품목",
      isValidWaste,
      isScreenCapture,
      principles,
      passedCount,
      earnedCoins,
      summaryFeedback:
        parsed.summaryFeedback ||
        (isValidWaste
          ? `환경부 4대 원칙 중 ${passedCount}가지를 충족했습니다.`
          : "실제 분리수거된 쓰레기가 확인되지 않아 인증이 반려되었습니다."),
      actionTip:
        parsed.actionTip ||
        "라벨 제거와 세척 상태가 잘 보이도록 촬영하면 더 정확하게 평가됩니다.",
    });
  } catch (error) {
    console.error("Analyze route error:", error);
    return NextResponse.json(
      { error: "사진을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
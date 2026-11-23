import { NextResponse } from "next/server";

type PrincipleKey = "empty" | "rinse" | "separate" | "noMix";
type DisposalCategory = "재활용" | "일반쓰레기" | "음식물쓰레기" | "특수배출" | "인식 불가";

interface PrincipleResult {
  key: PrincipleKey;
  label: string;
  passed: boolean;
  detail: string;
}

interface GeminiRawResponse {
  itemName?: string;
  disposalCategory?: string;
  detailedCategory?: string;
  disposalSteps?: string[];
  cautionNote?: string;
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

const SYSTEM_PROMPT = `
당신은 분리배출에 서툰 대한민국 1인 가구(자취생)를 돕는 친절하고 정확한 AI 분리배출 가이드이자 환경부 기준 심사관입니다.
사용자가 찍은 사진을 보고 ① 이 쓰레기가 무엇인지 ② 어디에 버려야 하는지(일반쓰레기/재활용/음식물쓰레기/특수배출) ③ 어떻게 처리해서 버려야 하는지 단계별로 알려주고, 재활용품이라면 현재 배출 상태도 평가하세요.

[어뷰징 및 부정 인증 판별 규칙]
1. 컴퓨터 모니터, 노트북, 스마트폰 화면을 다시 촬영한 사진(픽셀 격자, 베젤, 화면 반사광 등)이라면 반드시 isScreenCapture를 true로, disposalCategory를 "인식 불가"로 설정하세요.
2. 쓰레기나 버릴 물건이 보이지 않고 사람 얼굴, 풍경, 정상 사용 중인 가전·가구 등이라면 isValidWaste를 false로, disposalCategory를 "인식 불가"로 설정하세요.

[분류 기준 (disposalCategory는 반드시 아래 5개 중 하나)]
- "재활용": 투명 페트병, 유색 플라스틱, 알루미늄/철 캔, 유리병, 깨끗한 종이·택배 상자, 깨끗한 비닐류 등
- "일반쓰레기": 오염이 심해 씻기 어려운 배달 용기, 코팅 종이컵, 영수증(감열지), 빨대, 칫솔, 깨진 유리(신문지로 감싸서), 치킨 뼈/달걀 껍데기 등
- "음식물쓰레기": 동물이 먹을 수 있는 남은 음식물, 과일 껍질(수박·바나나·사과 등 부드러운 것)
- "특수배출": 폐건전지, 폐형광등, 폐의약품, 소형 폐가전, 대형폐기물
- "인식 불가": 쓰레기가 아니거나 화면 재촬영인 경우

[재활용품 환경부 4대 원칙 평가 기준]
- disposalCategory가 "재활용"일 때 현재 사진 속 상태를 평가하세요.
  - empty (비운다): 내용물·음료·음식물이 비워졌는지
  - rinse (헹군다): 눈에 띄는 오염·이물질이 헹궈졌는지 (종이·박스 등 세척 불필요 품목은 오염 없으면 통과)
  - separate (분리한다): 페트병 라벨/뚜껑, 상자 테이프·송장 등 다른 재질이 분리되었는지
  - noMix (섞지 않는다): 다른 재질과 섞이지 않고 단독으로 분류되었는지
- disposalCategory가 "일반쓰레기", "음식물쓰레기", "특수배출"인 경우 principles 항목들은 참고용으로 모두 passed: true로 두고 detail에 해당 분류 안내를 짧게 적으세요.

반드시 아래 JSON 형식으로만 한국어로 응답하세요.
{
  "itemName": "구체적인 쓰레기 품목명 (예: 일회용 커피컵, 영수증, 투명 페트병, 라면 봉지)",
  "disposalCategory": "재활용" | "일반쓰레기" | "음식물쓰레기" | "특수배출" | "인식 불가",
  "detailedCategory": "세부 배출함/방식 (예: 투명 페트병 전용함, 종량제 봉투, 플라스틱류, 폐건전지 수거함)",
  "disposalSteps": [
    "1단계: 1인 가구가 바로 따라할 수 있는 구체적 행동 1문장",
    "2단계: 구체적 행동 1문장",
    "3단계: 최종 버리는 곳 안내 1문장"
  ],
  "cautionNote": "자취생이 가장 많이 헷갈리는 핵심 주의사항 1문장 (예: 영수증은 감열지라 종이류가 아니라 일반쓰레기입니다.)",
  "isValidWaste": true 또는 false,
  "isScreenCapture": true 또는 false,
  "principles": {
    "empty": { "passed": true 또는 false, "detail": "판단 이유 1문장" },
    "rinse": { "passed": true 또는 false, "detail": "판단 이유 1문장" },
    "separate": { "passed": true 또는 false, "detail": "판단 이유 1문장" },
    "noMix": { "passed": true 또는 false, "detail": "판단 이유 1문장" }
  },
  "summaryFeedback": "현재 상태에 대한 전체 요약 1문장",
  "actionTip": "올바른 배출을 위한 추가 팁 1문장"
}
`.trim();

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

function calculateCoins(
  category: DisposalCategory,
  passedCount: number,
  isValid: boolean
): number {
  if (!isValid || category === "인식 불가") return 0;
  if (category !== "재활용") return 20; // 일반/음식물/특수배출 올바른 분류 학습 리워드
  if (passedCount >= 4) return 40;
  if (passedCount === 3) return 25;
  if (passedCount === 2) return 10;
  return 0;
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
    };

    if (!body.imageBase64 || !body.mimeType) {
      return NextResponse.json(
        { error: "분석할 이미지 데이터가 비어 있습니다." },
        { status: 400 }
      );
    }

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

    const geminiRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: SYSTEM_PROMPT },
              {
                inline_data: {
                  mime_type: body.mimeType,
                  data: body.imageBase64,
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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API Error:", geminiRes.status, errText);

      if (geminiRes.status === 429) {
        return NextResponse.json(
          { error: "AI 요청 한도를 잠시 초과했습니다. 10초 뒤 다시 시도해 주세요." },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: `AI 분석 요청에 실패했습니다. (상태 코드: ${geminiRes.status})` },
        { status: 502 }
      );
    }

    const geminiData = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return NextResponse.json(
        { error: "AI가 빈 응답을 반환했습니다. 사진을 다시 찍어 시도해 주세요." },
        { status: 502 }
      );
    }

    const cleanedText = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedText) as GeminiRawResponse;

    const isScreenCapture = Boolean(parsed.isScreenCapture);
    const isValidWaste = Boolean(parsed.isValidWaste) && !isScreenCapture;
    const disposalCategory: DisposalCategory = isValidWaste
      ? normalizeCategory(parsed.disposalCategory)
      : "인식 불가";

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
    const earnedCoins = calculateCoins(disposalCategory, passedCount, isValidWaste);

    const disposalSteps =
      Array.isArray(parsed.disposalSteps) && parsed.disposalSteps.length > 0
        ? parsed.disposalSteps.filter((s) => typeof s === "string" && s.trim().length > 0)
        : isValidWaste
        ? ["품목에 맞는 전용 배출함이나 종량제 봉투에 버려 주세요."]
        : ["실제 버릴 쓰레기를 카메라로 직접 촬영해 주세요."];

    return NextResponse.json({
      itemName: parsed.itemName || (isValidWaste ? "분리배출 품목" : "인식 불가"),
      disposalCategory,
      detailedCategory:
        parsed.detailedCategory || (isValidWaste ? disposalCategory : "인증 반려"),
      disposalSteps,
      cautionNote: parsed.cautionNote || "",
      isValidWaste,
      isScreenCapture,
      principles,
      passedCount,
      earnedCoins,
      summaryFeedback:
        parsed.summaryFeedback ||
        (isValidWaste
          ? `${disposalCategory} 품목으로 판별되었습니다.`
          : "실제 분리배출 쓰레기가 확인되지 않아 인증이 반려되었습니다."),
      actionTip:
        parsed.actionTip ||
        "버리기 전에 안내된 배출 방법을 한 번 더 확인해 주세요.",
    });
  } catch (error) {
    console.error("Analyze route error:", error);
    return NextResponse.json(
      { error: "사진을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
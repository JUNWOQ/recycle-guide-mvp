import { NextResponse } from "next/server";

type PrincipleKey = "empty" | "rinse" | "separate" | "noMix";

interface PrincipleResult {
  key: PrincipleKey;
  label: string;
  passed: boolean;
  detail: string;
}

interface GeminiRawResponse {
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

const SYSTEM_PROMPT = `
당신은 대한민국 환경부 분리배출 4대 원칙(비운다, 헹군다, 분리한다, 섞지 않는다)에 따라 사용자의 분리배출 사진을 엄격하고 친절하게 평가하는 AI 심사관입니다.

[어뷰징 및 부정 인증 판별 규칙]
1. 사진이 컴퓨터 모니터, 노트북, 스마트폰 화면을 다시 촬영한 것(픽셀 격자, 화면 베젤, 반사광 등)이라면 반드시 isScreenCapture를 true로 설정하세요.
2. 사진에 재활용·분리배출 대상 쓰레기(페트병, 플라스틱, 캔, 유리병, 종이·박스, 비닐 등)가 보이지 않고 사람, 풍경, 일반 사물 등이라면 isValidWaste를 false로 설정하세요.
3. isScreenCapture가 true이거나 isValidWaste가 false라면 4대 원칙 모두 passed를 false로 설정하세요.

[4대 원칙 평가 기준]
- empty (비운다): 용기 내부에 음료, 음식물, 내용물이 남아있지 않은지 평가
- rinse (헹군다): 용기 안팎에 눈에 띄는 이물질·오염이 씻겨 있는지 평가 (종이/박스 등 세척 불필요 품목은 오염 없으면 통과)
- separate (분리한다): 페트병 라벨/뚜껑 제거, 택배 상자 테이프·송장 제거 등 다른 재질이 분리되었는지 평가
- noMix (섞지 않는다): 서로 다른 재질의 쓰레기가 한 곳에 섞여 있지 않고 품목별로 잘 모아졌는지 평가

반드시 아래 JSON 형식으로만 한국어로 응답하세요.
{
  "itemName": "감지된 품목명 (예: 투명 페트병, 알루미늄 캔, 택배 상자, 인식 불가)",
  "isValidWaste": true 또는 false,
  "isScreenCapture": true 또는 false,
  "principles": {
    "empty": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" },
    "rinse": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" },
    "separate": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" },
    "noMix": { "passed": true 또는 false, "detail": "구체적인 판단 이유 1문장" }
  },
  "summaryFeedback": "전체 평가 요약 1문장",
  "actionTip": "더 많은 코인을 받거나 올바르게 배출하기 위한 구체적인 개선 팁 1문장"
}
`.trim();

function calculateCoins(passedCount: number, isValid: boolean): number {
  if (!isValid) return 0;
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

    const principles: PrincipleResult[] = [
      {
        key: "empty",
        label: "비운다",
        passed: isValidWaste && Boolean(parsed.principles?.empty?.passed),
        detail: parsed.principles?.empty?.detail || "판독 정보를 확인했습니다.",
      },
      {
        key: "rinse",
        label: "헹군다",
        passed: isValidWaste && Boolean(parsed.principles?.rinse?.passed),
        detail: parsed.principles?.rinse?.detail || "판독 정보를 확인했습니다.",
      },
      {
        key: "separate",
        label: "분리한다",
        passed: isValidWaste && Boolean(parsed.principles?.separate?.passed),
        detail: parsed.principles?.separate?.detail || "판독 정보를 확인했습니다.",
      },
      {
        key: "noMix",
        label: "섞지 않는다",
        passed: isValidWaste && Boolean(parsed.principles?.noMix?.passed),
        detail: parsed.principles?.noMix?.detail || "판독 정보를 확인했습니다.",
      },
    ];

    const passedCount = principles.filter((p) => p.passed).length;
    const earnedCoins = calculateCoins(passedCount, isValidWaste);

    return NextResponse.json({
      itemName: parsed.itemName || (isValidWaste ? "분리배출 품목" : "인식 불가"),
      isValidWaste,
      isScreenCapture,
      principles,
      passedCount,
      earnedCoins,
      summaryFeedback:
        parsed.summaryFeedback ||
        (isValidWaste
          ? `환경부 4대 원칙 중 ${passedCount}가지를 충족했습니다.`
          : "실제 분리배출 쓰레기가 확인되지 않아 인증이 반려되었습니다."),
      actionTip:
        parsed.actionTip ||
        "라벨 제거와 내용물 세척 상태를 잘 보이게 촬영하면 더 정확하게 평가됩니다.",
    });
  } catch (error) {
    console.error("Analyze route error:", error);
    return NextResponse.json(
      { error: "사진을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
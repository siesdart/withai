export function TermsOfServiceContent() {
  return (
    <article className="flex flex-col gap-8 leading-7 text-[#22221e]">
      <header className="border-b border-[#22221e]/20 pb-6">
        <span className="text-xs font-semibold tracking-wider text-[#a43b31] uppercase">
          Terms of Service
        </span>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">서비스 이용약관</h1>
        <p className="mt-3 text-sm text-[#625e55]">
          시행일자: 2026년 9월 20일 | WithAI 서비스 이용에 관한 권리와 의무, 책임사항 및 주요
          면책사항을 규정합니다.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">제1조 (목적)</h2>
        <p className="text-[#625e55]">
          본 약관은 WithAI(이하 ‘서비스’)가 제공하는 인공지능 기반 사회적 추론 게임 및 부가 서비스의
          이용과 관련하여, 운영자와 이용자(이하 ‘플레이어’) 간의 권리, 의무, 책임사항 및 서비스 이용
          조건 등을 규정함을 목적으로 합니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">제2조 (용어의 정의)</h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. ‘서비스’란 플레이어가 인공지능 참가자들과 함께 추리 게임을 즐길 수 있도록 운영자가
            제공하는 웹 기반 게임 애플리케이션(WithAI)을 의미합니다.
          </p>
          <p>
            2. ‘AI 참가자’란 플레이어를 제외하고 게임 내에서 마피아, 시민, 경찰, 의사 등의 역할을
            수행하는 Google Gemini 대형 언어 모델(LLM) 기반의 자율 에이전트를 의미합니다.
          </p>
          <p>
            3. ‘게임 세션’이란 1회의 게임 시작부터 종료(승패 판정 또는 중단)까지의 진행 단위 및 이에
            수반되는 임시 데이터 기록을 의미합니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">제3조 (약관의 효력 및 변경)</h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. 본 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이
            발생합니다.
          </p>
          <p>
            2. 운영자는 관계 법령을 위배하지 않는 범위 내에서 본 약관을 개정할 수 있으며, 약관 변경
            시 적용 일자 및 개정 사유를 명시하여 서비스 초기화면에 사전 공지합니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">제4조 (서비스 이용 및 게스트 정책)</h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. 서비스는 별도의 회원가입이나 로그인 없이 게스트 방식으로 즉시 이용할 수 있습니다.
          </p>
          <p>
            2. 공정한 서비스 환경 유지 및 외부 API 리소스 보호를 위해 1인당(IP 기준) 일일 플레이
            가능한 게임 세션 수(기본 5회)가 제한될 수 있으며, 해당 횟수는 매일 자정(UTC 00:00)을
            기준으로 초기화됩니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제5조 (인공지능 생성 콘텐츠의 성격 및 면책)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. <strong>가상성과 허구성:</strong> AI 참가자가 출력하는 대화, 추리, 변론 및 결정은
            인공지능에 의해 실시간으로 자동 생성된 게임 내 전략적 연출(블러핑, 페이크, 역할 사칭 등
            포함)이며, 실존 인물의 의사표현이나 실제 사실관계와 일절 무관합니다.
          </p>
          <p>
            2. <strong>내용의 비보증 및 면책:</strong> 운영자는 AI 참가자가 생성하는 발언 및
            결과물의 무결성, 정확성, 적법성, 특정 목적에의 적합성 및 도덕적 무해성을 보증하지
            않습니다. 인공지능의 확률적 특성으로 인해 발생할 수 있는 환각(Hallucination) 현상,
            예기치 않은 부적절한 표현으로 인한 직·간접적 손해에 대해 운영자는 책임을 부담하지
            않습니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제6조 (서비스 제공의 변경, 중단 및 외부 API 의존성)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. 본 서비스는 제3자 인공지능 API 공급자(Google LLC)의 기술 인프라에 의존하여
            구동됩니다.
          </p>
          <p>
            2. 외부 API 제공사의 장애, 정책 변경, 서비스 점검, 트래픽 폭증, 천재지변 또는 기술적
            필요에 따라 사전 통지 없이 서비스의 전부 또는 일부가 일시 중단되거나 지연될 수 있으며,
            운영자는 이로 인한 책임을 지지 않습니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">제7조 (이용자의 의무 및 금지 행위)</h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            이용자는 다음 각 호의 행위를 하여서는 안 되며, 적발 시 사전 통보 없이 서비스 이용이 영구
            차단될 수 있습니다:
          </p>
          <ul className="my-1 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>자동화 스크립트, 봇, 매크로를 이용한 비정상적 게임 생성 및 서버 부하 유발 행위</li>
            <li>
              IP 변조 또는 브라우저 조작 등을 통해 일일 게스트 플레이 횟수 제한을 무단 우회하는 행위
            </li>
            <li>
              AI 에이전트의 시스템 프롬프트를 탈취, 변조, 무력화하려는 프롬프트 인젝션(Prompt
              Injection) 시도
            </li>
            <li>
              게임 채팅을 통해 타인에 대한 욕설, 혐오, 차별, 음란물, 폭력적 표현을 전송하는 행위
            </li>
            <li>
              채팅 창에 본인 또는 타인의 민감한 개인정보(실명, 연락처, 주민번호 등)를 입력하는 행위
            </li>
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제8조 (지식재산권 및 AI 생성 데이터의 이용 제한)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. WithAI 웹 애플리케이션의 디자인, UI, 로고, 소프트웨어 코드 일체에 대한 권리는
            운영자에게 귀속됩니다.
          </p>
          <p>
            2. Google Generative AI 이용 약관에 따라, 이용자는 본 서비스에서 출력되는 AI 에이전트의
            발언 및 데이터를 무단 크롤링/수집하여{' '}
            <strong>
              Google과 경쟁하는 인공지능 모델의 학습(Training) 또는 미세조정(Fine-tuning)
              데이터셋으로 사용하는 행위를 엄격히 금지
            </strong>
            합니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-[#22221e]/20 pt-6">
        <h2 className="text-xl font-bold tracking-tight">제9조 (준거법 및 재판관할)</h2>
        <p className="text-[#625e55]">
          본 약관의 해석 및 운영자와 이용자 간의 분쟁에 관하여는 대한민국 법을 준거법으로 하며,
          서비스 이용과 관련하여 소송이 제기되는 경우 대한민국 법원을 관할 법원으로 합니다.
        </p>
      </section>
    </article>
  );
}

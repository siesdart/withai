export function PrivacyPolicyContent() {
  return (
    <article className="flex flex-col gap-8 leading-7 text-[#22221e]">
      <header className="border-b border-[#22221e]/20 pb-6">
        <span className="text-xs font-semibold tracking-wider text-[#a43b31] uppercase">
          Legal & AI Policy
        </span>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          개인정보 처리방침 및 AI 서비스 이용약관
        </h1>
        <p className="mt-3 text-sm text-[#625e55]">
          시행일자: 2026년 9월 20일 | WithAI는 이용자의 프라이버시를 존중하며, 투명한 AI 서비스
          제공을 위해 노력합니다.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">제1조 (목적)</h2>
        <p className="text-[#625e55]">
          본 방침은 WithAI(이하 ‘서비스’)가 제공하는 AI 기반 사회적 추론 게임(마피아 게임 등)을
          이용함에 있어, 이용자의 데이터 처리 방식과 생성형 인공지능(AI) 서비스 이용 조건을 명확히
          안내하는 것을 목적으로 합니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제2조 (인공지능 기반 서비스 및 AI 생성물 고지)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. 본 서비스에서 플레이어를 제외한 모든 게임 참가자(마피아, 경찰, 의사, 시민 등)는{' '}
            <strong>Google Gemini 대형 언어 모델(LLM)</strong>을 기반으로 작동하는 자율 AI
            에이전트입니다.
          </p>
          <p>
            2. AI 참가자가 출력하는 모든 공개 발언, 추리 내용, 최후 변론 및 밤 행동은 인공지능
            알고리즘에 의해 실시간으로 자동 생성된 콘텐츠입니다. 이는 게임 내 전략(블러핑, 페이크
            등)을 위해 연출된 가상의 발언이며, 어떠한 실존 인물이나 사실관계를 대변하지 않습니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제3조 (처리하는 데이터 항목 및 외부 AI API 전송)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            게임 진행 및 실시간 AI 에이전트와의 상호작용을 위해 다음과 같은 데이터가 처리 및 외부
            클라우드로 전송됩니다.
          </p>
          <div className="my-2 overflow-x-auto border border-[#22221e]/20 bg-[#f4efe7]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#22221e]/20 bg-[#e9e3d6]/60 font-semibold">
                <tr>
                  <th className="p-3">처리 항목</th>
                  <th className="p-3">전송 대상 (수탁자)</th>
                  <th className="p-3">이용 목적</th>
                  <th className="p-3">보유 및 파기 기간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22221e]/10">
                <tr>
                  <td className="p-3 font-medium">
                    플레이어 닉네임, 실시간 게임 채팅 입력문, 지목/투표 기록
                  </td>
                  <td className="p-3">Google LLC (Google Gemini API)</td>
                  <td className="p-3">AI 참가자의 상황 맥락 파악 및 실시간 대화·추리 응답 생성</td>
                  <td className="p-3">
                    게임 종료 후 결과 확인을 위해 최대 24시간 보관 후 자동 영구 파기 (중단 시 1시간
                    이내)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#a43b31]">
            * 민감한 개인정보(실명, 전화번호, 주민등록번호, 금융정보 등)는 게임 채팅에 절대 입력하지
            마십시오.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제4조 (데이터 프라이버시 및 보관 수명주기·파기 정책)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. 서비스 운영 환경에서는 기업용 API 정책에 따라 이용자의 프롬프트 데이터가 Google의
            일반 인공지능 기본 모델 학습에 활용되지 않도록 보호 조치를 취하고 있습니다.
          </p>
          <p>
            2. 게임 세션 데이터(플레이어 대화 내용, 게임 상태 기록)는 원활한 게임 진행, 네트워크
            단절 시 재접속, 결과 확인을 위해 인메모리 캐시(Redis)에 일시적으로 유지됩니다. 데이터는
            수명주기(TTL) 만료 시 영구 저장소로 이관되지 않고 즉시 완전 파기되며, 구체적인 기준은
            다음과 같습니다:
          </p>
          <ul className="my-1 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>
              <strong>게임 완료(정상 종료) 세션:</strong> 종료 후 결과 화면 확인 및 복기를 위해{' '}
              <strong>최대 24시간</strong> 보관 후 자동 파기
            </li>
            <li>
              <strong>중단(이탈) 세션:</strong> 플레이어가 게임 도중 이탈한 경우{' '}
              <strong>60분</strong> 후 자동 만료 및 파기
            </li>
            <li>
              <strong>진행 중 유휴 세션:</strong> 플레이어의 추가 입력 없이 방치될 경우{' '}
              <strong>15분</strong> 후 자동 종료 처리
            </li>
            <li>
              <strong>게스트 플레이 카운트:</strong> 공정한 서비스 이용을 위한 일일 플레이 횟수
              기록은 매일 자정(UTC 00:00) 자동 초기화
            </li>
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          제5조 (이용자 준수사항 및 AI 생성물 저작권/학습 금지)
        </h2>
        <div className="flex flex-col gap-2 text-[#625e55]">
          <p>
            1. Google Generative AI 이용 약관 및 정책에 따라, 이용자는 본 서비스에서 출력되는 AI
            에이전트의 응답을 무단 수집·스크래핑하여{' '}
            <strong>
              Google과 경쟁하는 인공지능/머신러닝 모델의 훈련 데이터셋으로 활용할 수 없습니다.
            </strong>
          </p>
          <p>
            2. 음란물, 욕설, 혐오 발언, 폭력적 위협, 프롬프트 인젝션 공격(시스템 프롬프트 탈취/변조
            시도) 등 유해한 입력은 엄격히 금지되며, Google Safety Filter에 의해 차단되거나 플레이가
            제한될 수 있습니다.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-[#22221e]/20 pt-6">
        <h2 className="text-xl font-bold tracking-tight">제6조 (문의 및 지원)</h2>
        <p className="text-[#625e55]">
          서비스 이용 또는 개인정보 처리와 관련된 문의 사항이 있으신 경우 프로젝트 관리자(
          <a href="mailto:ghwhsbsb123@naver.com">ghwhsbsb123@naver.com</a>)를 통해 문의해 주시기
          바랍니다.
        </p>
      </section>
    </article>
  );
}

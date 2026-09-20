export const gameResources = {
  en: {
    game: {
      participants: {
        heading: 'Mafia {{mafiaCount}} : Citizen {{citizenCount}}',
        alive: 'alive',
        you: '(you)',
        choose: '{{actionLabel}}: {{participantName}}',
        roleMemo: '{{participantName}} role memo',
        unknown: 'Unknown',
        fallback: 'Participant',
      },
      roles: { Mafia: 'Mafia', Citizen: 'Citizen', Police: 'Police', Doctor: 'Doctor' },
      allegiances: { Mafia: 'Mafia', Citizen: 'Citizen' },
      actionLabels: {
        nominate: 'Nominate',
        target: 'Target',
        protect: 'Protect',
        investigate: 'Investigate',
      },
      phases: {
        discussion: 'discussion',
        nomination: 'nomination',
        'final-defence': 'final defence',
        verdict: 'verdict',
        night: 'night',
      },
      table: {
        dayPeriod: 'Day {{dayNumber}} / day',
        nightPeriod: 'Day {{dayNumber}} / night',
        daySegment: 'Day {{dayNumber}} day records',
        nightSegment: 'Day {{dayNumber}} night records',
        reconnecting: 'Reconnecting live updates…',
        backToGameList: 'Game list',
        scrollToLatest: 'Scroll to latest messages',
      },
      message: {
        label: 'Message',
        placeholder: 'Write a message…',
        send: 'Send message',
      },
      discussionTime: {
        controls: 'Discussion time controls',
        tenSeconds: '10s',
        remove: 'Remove {{seconds}} seconds from the discussion timer.{{cooldown}}',
        add: 'Add {{seconds}} seconds to the discussion timer.{{cooldown}}',
        cooldown: ' Available again in {{retryAfterSeconds}} seconds.',
      },
      phasePanel: {
        completedObserver:
          'You are now observing the completed game. The full vote record is available below.',
        eliminatedObserver:
          'You are out of the game. You can continue to observe each phase and its results.',
        chooseNominee: 'Choose a nominee',
        selectAliveParticipant: 'Select an alive participant from the participant list.',
        finalDefence: 'Final defence',
        nomineeHasFloor: '{{participantName}} is nominated and has the floor.',
        nomineePreparingDefence: 'The nominated participant is preparing a final defence.',
        verdictFor: 'Verdict for {{participantName}}',
        eliminate: 'Eliminate',
        spare: 'Spare',
        nightPrompt: {
          Mafia: 'Choose a target',
          Doctor: 'Choose someone to protect',
          Police: 'Choose someone to investigate',
          Citizen: 'Night actions are private',
        },
        waitForDawn: 'Wait for dawn.',
      },
      timer: { resolving: 'Resolving result' },
      errors: {
        sessionTitle: 'The Game Session could not start.',
        sessionDescription: 'Check your connection, then try again.',
        tryAgain: 'Try again',
        actionNotAccepted: 'Your action was not accepted. The server state is authoritative.',
        rateLimited: 'Please wait before submitting another action.',
        duplicateRequest: 'This action was already submitted with a different request.',
        phaseExpired: 'This action is no longer permitted; the current Phase may have expired.',
      },
      loading: {
        publicDiscussion: 'Loading public discussion',
        participants: 'Loading participants',
        gameSession: 'Starting Game Session',
      },
      records: {
        fallback: 'Participant',
        nominated:
          'Day {{dayNumber}}: {{participantName}} was nominated with {{count}} vote{{pluralSuffix}}.',
        nominationTie:
          'Day {{dayNumber}}: nomination ended in a tie at {{count}} vote{{pluralSuffix}}.',
        noNomination: 'Day {{dayNumber}}: no nomination was submitted.',
        verdictEliminated: 'Day {{dayNumber}}: {{participantName}} was eliminated.',
        verdictTied: 'Day {{dayNumber}}: {{participantName}} was spared after a tied verdict.',
        verdictNoMajority:
          'Day {{dayNumber}}: {{participantName}} was spared because elimination did not reach a majority.',
        dayStarted: 'Day {{dayNumber}}: day has begun.',
        discussionTimeAdded: 'Day {{dayNumber}}: added 10 seconds to the timer.',
        discussionTimeRemoved: 'Day {{dayNumber}}: removed 10 seconds from the timer.',
        phaseStarted: 'Day {{dayNumber}}: {{phase}} phase started.',
        gameCompleted: 'The game is complete.',
        allegianceReveal: '{{participantName}} was {{allegiance}}.',
        victory: '{{allegiance}} team wins.',
        nightProtected: 'Day {{dayNumber}}: Doctor saved the targeted Participant overnight.',
        nightNoDeath: 'Day {{dayNumber}}: no Participant was eliminated overnight.',
        nightParticipantEliminated:
          'Day {{dayNumber}}: {{participantName}} was eliminated overnight.',
        discussionLimitReached:
          'Day {{dayNumber}}: Agents have reached their discussion turn limit. Move to the next phase when you are ready.',
        policeInvestigation:
          'Day {{dayNumber}}: Police investigation — {{participantName}} has {{allegiance}} Allegiance.',
        voteTotal: '{{participantName}} {{voteCount}}',
        voteTotals: 'Vote totals: {{totals}}',
        verdictTotals: 'Eliminate {{eliminateVotes}}, spare {{spareVotes}}.',
        fullRecord: 'View the full game record',
        day: 'Day {{dayNumber}}',
        nightActions: 'Night actions',
        mafiaTarget: 'Mafia target: {{targetName}}',
        noTarget: 'no target',
        actionRecord: '{{role}} {{participantName}}: {{targetName}}',
        noAction: 'no action',
        nomination: 'Nomination',
        verdict: 'Verdict',
        vote: '{{participantName}}: {{choice}}',
        nominatedVote: '{{participantName}}: nominated {{targetName}}',
        eliminateVote: 'eliminate',
        spareVote: 'spare',
      },
    },
  },
  ko: {
    game: {
      participants: {
        heading: '마피아 {{mafiaCount}} : 시민 {{citizenCount}}',
        alive: '생존',
        you: '(나)',
        choose: '{{actionLabel}}: {{participantName}}',
        roleMemo: '{{participantName}} 역할 메모',
        unknown: '미상',
        fallback: '참가자',
      },
      roles: { Mafia: '마피아', Citizen: '시민', Police: '경찰', Doctor: '의사' },
      allegiances: { Mafia: '마피아', Citizen: '시민' },
      actionLabels: {
        nominate: '지목',
        target: '표적 선택',
        protect: '보호 대상 선택',
        investigate: '조사 대상 선택',
      },
      phases: {
        discussion: '토론',
        nomination: '지목',
        'final-defence': '최후 변론',
        verdict: '찬반 투표',
        night: '밤',
      },
      table: {
        dayPeriod: '{{dayNumber}}일차 / 낮',
        nightPeriod: '{{dayNumber}}일차 / 밤',
        daySegment: '{{dayNumber}}일차 낮 기록',
        nightSegment: '{{dayNumber}}일차 밤 기록',
        reconnecting: '실시간 업데이트를 다시 연결하고 있어요…',
        backToGameList: '게임 목록으로',
        scrollToLatest: '최신 메시지로 이동',
      },
      message: {
        label: '메시지',
        placeholder: '메시지를 입력하세요…',
        send: '메시지 보내기',
      },
      discussionTime: {
        controls: '토론 시간 조절',
        tenSeconds: '10초',
        remove: '토론 시간을 {{seconds}}초 줄이기.{{cooldown}}',
        add: '토론 시간을 {{seconds}}초 늘리기.{{cooldown}}',
        cooldown: ' {{retryAfterSeconds}}초 후 다시 사용할 수 있어요.',
      },
      phasePanel: {
        completedObserver: '게임이 끝났습니다. 아래에서 전체 투표 기록을 확인할 수 있어요.',
        eliminatedObserver: '사망하였습니다. 각 단계와 결과를 계속 지켜볼 수 있어요.',
        chooseNominee: '처형할 사람을 지목하세요',
        selectAliveParticipant: '참가자 목록에서 생존자 중 하나를 선택하세요.',
        finalDefence: '최후 변론',
        nomineeHasFloor: '{{participantName}}님이 지목되어 변론 중입니다.',
        nomineePreparingDefence: '지목된 참가자가 최후 변론을 준비하고 있습니다.',
        verdictFor: '{{participantName}}님 찬반 투표',
        eliminate: '처형',
        spare: '생존',
        nightPrompt: {
          Mafia: '제거할 표적을 선택하세요',
          Doctor: '보호할 참가자를 선택하세요',
          Police: '조사할 참가자를 선택하세요',
          Citizen: '밤 행동은 비공개입니다',
        },
        waitForDawn: '날이 밝을 때까지 기다리세요.',
      },
      timer: { resolving: '결과를 집계하고 있어요' },
      errors: {
        sessionTitle: '게임을 시작하지 못했어요.',
        sessionDescription: '연결을 확인한 뒤 다시 시도해 주세요.',
        tryAgain: '다시 시도',
        actionNotAccepted: '행동이 승인되지 않았어요. 서버의 게임 상태를 기준으로 진행합니다.',
        rateLimited: '잠시 기다린 뒤 다시 행동해 주세요.',
        duplicateRequest: '다른 요청으로 이미 제출된 행동입니다.',
        phaseExpired: '현재 단계가 끝나 이 행동을 제출할 수 없어요.',
      },
      loading: {
        publicDiscussion: '공개 토론을 불러오는 중',
        participants: '참가자 목록을 불러오는 중',
        gameSession: '게임을 시작하는 중',
      },
      records: {
        fallback: '참가자',
        nominated:
          '{{dayNumber}}일차: {{participantName}}님이 {{count}}표를 받아 변론 대상으로 지목되었습니다.',
        nominationTie: '{{dayNumber}}일차: 지목 투표가 {{count}}표 동률로 끝났습니다.',
        noNomination: '{{dayNumber}}일차: 지목이 제출되지 않았습니다.',
        verdictEliminated: '{{dayNumber}}일차: {{participantName}}님이 사망했습니다.',
        verdictTied: '{{dayNumber}}일차: {{participantName}}님이 찬반 투표 동률로 살아남았습니다.',
        verdictNoMajority:
          '{{dayNumber}}일차: 처형 찬성이 과반수에 이르지 않아 {{participantName}}님이 살아남았습니다.',
        dayStarted: '{{dayNumber}}일차 낮이 시작되었습니다.',
        discussionTimeAdded: '{{dayNumber}}일차: 토론 시간이 10초 늘어났습니다.',
        discussionTimeRemoved: '{{dayNumber}}일차: 토론 시간이 10초 줄었습니다.',
        phaseStarted: '{{dayNumber}}일차 {{phase}}이 시작되었습니다.',
        gameCompleted: '게임이 종료되었습니다.',
        allegianceReveal: '{{participantName}}님의 진영은 {{allegiance}}입니다.',
        victory: '{{allegiance}} 진영 승리!',
        nightProtected: '{{dayNumber}}일차: 의사가 마피아의 표적을 보호했습니다.',
        nightNoDeath: '{{dayNumber}}일차: 밤사이 사망한 참가자가 없습니다.',
        nightParticipantEliminated:
          '{{dayNumber}}일차: {{participantName}}님이 밤사이 사망했습니다.',
        discussionLimitReached:
          '{{dayNumber}}일차: AI 참가자들의 토론 횟수가 끝났습니다. 준비되면 다음 단계로 넘어가세요.',
        policeInvestigation:
          '{{dayNumber}}일차: 경찰 조사 결과 — {{participantName}}님의 진영은 {{allegiance}}입니다.',
        voteTotal: '{{participantName}} {{voteCount}}표',
        voteTotals: '지목 득표: {{totals}}',
        verdictTotals: '처형 {{eliminateVotes}}표, 생존 {{spareVotes}}표.',
        fullRecord: '전체 게임 기록 보기',
        day: '{{dayNumber}}일차',
        nightActions: '밤 행동',
        mafiaTarget: '마피아 표적: {{targetName}}',
        noTarget: '표적 없음',
        actionRecord: '{{role}} {{participantName}}: {{targetName}}',
        noAction: '행동 없음',
        nomination: '지목 투표',
        verdict: '찬반 투표',
        vote: '{{participantName}}: {{choice}}',
        nominatedVote: '{{participantName}}: {{targetName}}님 지목',
        eliminateVote: '처형',
        spareVote: '생존',
      },
    },
  },
} as const;

type WidenTranslationStrings<Value> = Value extends string
  ? string
  : Value extends Record<string, unknown>
    ? { readonly [Key in keyof Value]: WidenTranslationStrings<Value[Key]> }
    : never;

type Assert<Condition extends true> = Condition;

export type GameLocalesHaveMatchingKeys = Assert<
  typeof gameResources.ko extends WidenTranslationStrings<typeof gameResources.en> ? true : false
>;

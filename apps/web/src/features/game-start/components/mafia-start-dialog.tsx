/* oxlint-disable react-perf/jsx-no-jsx-as-prop, react-perf/jsx-no-new-function-as-prop -- Base UI controls require render composition and controlled form event adapters. */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { Button } from '@repo/ui/components/button';
import { Dialog } from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import { Progress, ProgressLabel } from '@repo/ui/components/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';

import { useMafiaGameCreation } from '../hooks/use-mafia-game-creation';

type MafiaStartDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MafiaStartDialog({ open, onOpenChange }: MafiaStartDialogProps) {
  const creation = useMafiaGameCreation();
  const defaultName = creation.outputLanguage === 'ko' ? '플레이어' : 'Player';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      disablePointerDismissal={creation.isCreating}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-[#22221e]/45" />
        <Dialog.Viewport className="fixed inset-0 flex items-end justify-center p-3 sm:items-center">
          <Dialog.Popup className="w-full max-w-lg border-2 border-[#22221e] bg-[#f4efe7] p-5 shadow-2xl sm:p-7">
            <Dialog.Title className="text-2xl font-bold tracking-[-0.035em]">
              마피아 게임 시작
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-[#625e55]">
              AI 참가자들과 함께, 나만의 추리 테이블을 열어 보세요.
            </Dialog.Description>

            <Accordion className="mt-5 border-y border-[#22221e]/20">
              <AccordionItem value="rules">
                <AccordionTrigger>게임 규칙 보기</AccordionTrigger>
                <AccordionContent className="pb-3 text-[#625e55]">
                  <ul className="flex list-disc flex-col gap-2 pl-4 leading-5">
                    <li>마피아를 찾아내는 AI와의 사회적 추론 게임입니다.</li>
                    <li>역할은 마피아, 시민, 경찰, 의사로 나뉩니다.</li>
                    <li>낮에는 대화·지목·투표를, 밤에는 역할별 비공개 행동을 합니다.</li>
                    <li>마피아를 모두 찾으면 시민 승리, 수가 같아지면 마피아 승리입니다.</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="human-name">
                플레이어 이름 <span className="font-normal text-[#625e55]">선택</span>
                <Input
                  id="human-name"
                  value={creation.humanName}
                  onChange={(event) => creation.setHumanName(event.target.value)}
                  disabled={creation.isCreating}
                  maxLength={20}
                  placeholder={`비워 두면 ‘${defaultName}’`}
                />
              </label>
              <div className="flex flex-col gap-2 text-sm font-medium">
                <span id="game-language-label">게임 언어</span>
                <Select
                  value={creation.outputLanguage}
                  onValueChange={(value) => {
                    if (value === 'ko' || value === 'en') creation.setOutputLanguage(value);
                  }}
                  disabled={creation.isCreating}
                >
                  <SelectTrigger aria-labelledby="game-language-label" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ko">한국어</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {creation.isCreating ? (
              <Progress className="mt-6" value={null}>
                <ProgressLabel>게임 준비 중…</ProgressLabel>
              </Progress>
            ) : null}
            {creation.creationError ? (
              <p className="mt-4 text-sm text-destructive">{creation.creationError}</p>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close render={<Button variant="outline" disabled={creation.isCreating} />}>
                닫기
              </Dialog.Close>
              <Button onClick={() => void creation.startGame()} disabled={creation.isCreating}>
                게임 시작
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { Button } from '@repo/ui/components/button';

import { useGameTranslation } from '../../i18n/use-game-translation';

type ControlRoomErrorProps = {
  onRetry: () => void;
  title?: string;
  description?: string;
};

export function ControlRoomError({ onRetry, title, description }: ControlRoomErrorProps) {
  const { t, language } = useGameTranslation();

  return (
    <main
      lang={language}
      className="flex min-h-dvh items-center justify-center bg-[#e9e3d6] px-4 text-[#22221e]"
    >
      <section className="max-w-md border-2 border-[#a43b31] bg-[#f4efe7] p-6">
        <h1 className="text-2xl font-semibold">{title ?? t('errors.sessionTitle')}</h1>
        <p className="mt-3 text-sm text-[#625e55]">
          {description ?? t('errors.sessionDescription')}
        </p>
        <div className="mt-6 flex gap-3">
          <Button className="bg-[#22221e] text-[#f4efe7]" onClick={onRetry}>
            {t('errors.tryAgain')}
          </Button>
        </div>
      </section>
    </main>
  );
}

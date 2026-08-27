import { Button } from '@repo/ui/components/button';

type ControlRoomErrorProps = {
  onRetry?: () => void;
  onStartNewGame?: () => void;
  title?: string;
  description?: string;
};

export function ControlRoomError({
  onRetry,
  onStartNewGame,
  title = 'The Game Session could not start.',
  description = 'Check your connection, then try again.',
}: ControlRoomErrorProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#e9e3d6] px-4 text-[#22221e]">
      <section className="max-w-md border-2 border-[#a43b31] bg-[#f4efe7] p-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-[#625e55]">{description}</p>
        <div className="mt-6 flex gap-3">
          {onRetry ? (
            <Button className="bg-[#22221e] text-[#f4efe7]" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {onStartNewGame ? <Button onClick={onStartNewGame}>Start a new game</Button> : null}
        </div>
      </section>
    </main>
  );
}

import { Button } from '@repo/ui/components/button';

type ControlRoomErrorProps = {
  onRetry: () => void;
};

export function ControlRoomError({ onRetry }: ControlRoomErrorProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#e9e3d6] px-4 text-[#22221e]">
      <section className="max-w-md border-2 border-[#a43b31] bg-[#f4efe7] p-6">
        <h1 className="text-2xl font-semibold">The Game Session could not start.</h1>
        <p className="mt-3 text-sm text-[#625e55]">Check your connection, then try again.</p>
        <Button className="mt-6 bg-[#22221e] text-[#f4efe7]" onClick={onRetry}>
          Try again
        </Button>
      </section>
    </main>
  );
}

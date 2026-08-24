import { Button } from '@repo/ui/components/button';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect } from 'react';

type PrototypeSwitcherProps = {
  current: string;
  onChange: (variant: string) => void;
  variants: ReadonlyArray<{ key: string; name: string }>;
};

export function PrototypeSwitcher({ current, onChange, variants }: PrototypeSwitcherProps) {
  const currentIndex = variants.findIndex((variant) => variant.key === current);
  const goTo = useCallback(
    (offset: number) => {
      const nextIndex = (currentIndex + offset + variants.length) % variants.length;
      onChange(variants[nextIndex]?.key ?? variants[0].key);
    },
    [currentIndex, onChange, variants],
  );
  const goPrevious = useCallback(() => goTo(-1), [goTo]);
  const goNext = useCallback(() => goTo(1), [goTo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        goTo(-1);
      }
      if (event.key === 'ArrowRight') {
        goTo(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goTo]);

  if (import.meta.env.PROD) {
    return null;
  }

  const currentVariant = variants[currentIndex] ?? variants[0];
  return (
    <div className="fixed right-1/2 bottom-5 z-50 translate-x-1/2 border border-white/20 bg-[#151515] p-1 text-white shadow-2xl">
      <div className="flex items-center gap-1">
        <Button
          aria-label="Previous prototype variant"
          variant="ghost"
          size="icon-sm"
          onClick={goPrevious}
          className="text-white hover:bg-white/15 hover:text-white"
        >
          <ChevronLeftIcon data-icon="inline-start" />
        </Button>
        <span className="min-w-44 px-2 text-center text-xs tracking-[0.12em] uppercase">
          {currentVariant.key} · {currentVariant.name}
        </span>
        <Button
          aria-label="Next prototype variant"
          variant="ghost"
          size="icon-sm"
          onClick={goNext}
          className="text-white hover:bg-white/15 hover:text-white"
        >
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

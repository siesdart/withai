import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import {
  ControlRoomVariant,
  StageVariant,
  StorylineVariant,
} from '@/components/mafia-prototype-variants';
import { PrototypeSwitcher } from '@/components/prototype-switcher';

const variants = [
  { key: 'A', name: 'Control room' },
  { key: 'B', name: 'Storyline' },
  { key: 'C', name: 'Stage' },
] as const;

type VariantKey = (typeof variants)[number]['key'];

function isVariantKey(value: unknown): value is VariantKey {
  return typeof value === 'string' && variants.some((variant) => variant.key === value);
}

export const Route = createFileRoute('/prototype/mafia')({
  validateSearch: (search: Record<string, unknown>): { variant: VariantKey } => ({
    variant: isVariantKey(search.variant) ? search.variant : 'A',
  }),
  component: MafiaPrototype,
});

function MafiaPrototype() {
  const { variant } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const onChange = useCallback(
    (nextVariant: string) => {
      if (isVariantKey(nextVariant)) {
        void navigate({ search: { variant: nextVariant } });
      }
    },
    [navigate],
  );

  const screen = {
    A: <ControlRoomVariant onAction={setNotice} />,
    B: <StorylineVariant onAction={setNotice} />,
    C: <StageVariant onAction={setNotice} />,
  }[variant];

  return (
    <div>
      {screen}
      {notice ? (
        <output className="fixed top-5 right-5 z-50 max-w-sm border border-[#e7c47b]/60 bg-[#171717] px-4 py-3 text-sm text-[#f3efe6] shadow-xl">
          {notice}
        </output>
      ) : null}
      <PrototypeSwitcher current={variant} onChange={onChange} variants={variants} />
    </div>
  );
}

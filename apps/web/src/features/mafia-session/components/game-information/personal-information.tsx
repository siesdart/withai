import type { MafiaGameProjection } from '../../api/client';

export function PersonalInformation({
  personal,
  compact = false,
}: {
  personal: MafiaGameProjection['personal'];
  compact?: boolean;
}) {
  return (
    <>
      <dl className={compact ? 'mt-0 flex flex-col gap-3' : 'mt-5 flex flex-col gap-4'}>
        <div>
          <dt className="text-xs text-[#625e55]">Role</dt>
          <dd className="mt-1 text-xl font-semibold">{personal.role}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#625e55]">Allegiance</dt>
          <dd className="mt-1 text-lg font-semibold">{personal.allegiance}</dd>
        </div>
      </dl>
      <p className={compact ? 'mt-4 text-sm text-[#625e55]' : 'mt-8 text-sm text-[#625e55]'}>
        Only this browser identity can reopen this Game Session.
      </p>
    </>
  );
}

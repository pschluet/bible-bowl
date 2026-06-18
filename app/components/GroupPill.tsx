import { GROUP_LABELS, type GroupType } from '@/app/lib/constants';

const COLOR: Record<GroupType, string> = {
  Teen: 'bg-indigo-100 text-indigo-700',
  PreTeen: 'bg-emerald-100 text-emerald-700',
  Adult: 'bg-purple-100 text-purple-700',
};

export default function GroupPill({ groupType }: { groupType?: string | null }) {
  if (!groupType || !(groupType in GROUP_LABELS)) return null;
  const key = groupType as GroupType;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR[key]}`}>
      {GROUP_LABELS[key]}
    </span>
  );
}

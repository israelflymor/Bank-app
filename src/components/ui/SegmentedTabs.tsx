import React from 'react';
import { motion } from 'motion/react';

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedTabsProps<T extends string> {
  layoutId: string;
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedTabs<T extends string>({
  layoutId,
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: SegmentedTabsProps<T>) {
  const padClass = size === 'sm' ? 'px-3 py-1.5' : 'px-3.5 py-2';

  return (
    <div
      role="tablist"
      className={`inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/80 border border-slate-300/60 rounded-lg ${className}`}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`relative inline-flex items-center gap-1.5 ${padClass} text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 bg-white rounded-md shadow-xs border border-slate-200/80"
                aria-hidden="true"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              <span>{opt.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { cn } from 'cn';
import type { ReactNode } from 'react';

type GameArticleProps = {
  number: string;
  title: string;
  description: string;
  variant: 'featured' | 'upcoming';
  children: ReactNode;
};

export function GameArticle({ number, title, description, variant, children }: GameArticleProps) {
  return (
    <article
      className={cn(
        'flex min-h-72 flex-col justify-between p-5 sm:p-7',
        variant === 'featured'
          ? 'border-2 border-[#22221e] bg-[#f4efe7] transition-transform duration-500 hover:-translate-y-1'
          : 'border border-dashed border-[#22221e]/45 bg-[#e9e3d6] text-[#625e55]',
      )}
    >
      <div>
        <span className={cn('text-sm', variant === 'featured' && 'text-[#a43b31]')}>{number}</span>
        <h3 className="mt-8 text-3xl font-bold tracking-tighter">{title}</h3>
        <p
          className={cn(
            'mt-3 max-w-sm text-sm leading-6',
            variant === 'featured' && 'text-[#625e55]',
          )}
        >
          {description}
        </p>
      </div>
      {children}
    </article>
  );
}

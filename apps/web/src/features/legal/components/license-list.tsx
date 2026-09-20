import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { ExternalLink, Search } from 'lucide-react';
import { type ChangeEvent, type MouseEvent, useCallback, useMemo, useState } from 'react';
import { sortBy } from 'remeda';

import { openSourceLicenses } from '../data/licenses-data.gen';

export function LicenseList() {
  const [search, setSearch] = useState('');
  const [selectedLicense, setSelectedLicense] = useState<string>('ALL');

  const licenseTypes = useMemo(() => {
    const types = new Set(openSourceLicenses.map((item) => item.license));
    return ['ALL', ...sortBy(Array.from(types), [(x) => x, 'asc'])];
  }, []);

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  const handleFilterClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const type = e.currentTarget.dataset.license;
    if (type) setSelectedLicense(type);
  }, []);

  const filteredLicenses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return openSourceLicenses.filter((item) => {
      const matchesSearch =
        query === '' ||
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query);
      const matchesLicense = selectedLicense === 'ALL' || item.license === selectedLicense;
      return matchesSearch && matchesLicense;
    });
  }, [search, selectedLicense]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-none border-2 border-[#22221e] bg-[#f4efe7] p-4 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative flex-1" htmlFor="license-search">
            <span className="sr-only">패키지 검색</span>
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#625e55]" />
            <Input
              id="license-search"
              placeholder="패키지명 또는 설명 검색..."
              value={search}
              onChange={handleSearchChange}
              className="bg-[#e9e3d6]/50 pl-9"
            />
          </label>
          <span className="text-xs text-[#625e55]">
            총 {filteredLicenses.length}개 라이브러리 표시 중
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-[#22221e]/15 pt-2">
          {licenseTypes.map((type) => (
            <Button
              key={type}
              data-license={type}
              variant={selectedLicense === type ? 'default' : 'outline'}
              size="sm"
              onClick={handleFilterClick}
              className="h-7 px-2.5 text-xs"
            >
              {type}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {filteredLicenses.map((item) => (
          <article
            key={item.name}
            className="flex flex-col justify-between border-2 border-[#22221e] bg-[#f4efe7] p-4 transition-transform duration-300 hover:-translate-y-0.5 sm:p-5"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold tracking-tight break-all text-[#22221e]">
                  {item.name}
                </h3>
                <span className="shrink-0 rounded-none border border-[#22221e] bg-[#e9e3d6] px-2 py-0.5 text-xs font-semibold text-[#a43b31]">
                  {item.license}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#625e55]">v{item.version}</p>
              {item.description ? (
                <p className="mt-3 line-clamp-2 text-sm leading-5 text-[#625e55]">
                  {item.description}
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[#22221e]/10 pt-3 text-xs text-[#625e55]">
              <span className="max-w-50 truncate">
                {item.author ? `Author: ${item.author}` : ''}
              </span>
              {item.homepage ? (
                <a
                  href={item.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#22221e] underline underline-offset-2 hover:text-[#a43b31]"
                >
                  저장소 <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * SearchPanel —— 搜索面板（顶部下拉）。
 *
 * 接 core 的 `PdfSearch`：
 * - 索引**懒建**（第一次搜索时才建，不拖慢首屏）
 * - 命中按页码顺序，上限可配
 * - 跳转到命中项 → 宿主滚动到该页
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfSearch, SearchHit } from '../core/search/search';
import type { Locale, Messages } from '../i18n/messages';
import { resolveMessage } from '../i18n/messages';

/** SearchPanel 参数 */
export interface SearchPanelProps {
  /** 搜索引擎（core 的 PdfSearch 实例） */
  search: PdfSearch | null;
  /** 关闭面板 */
  onClose: () => void;
  /** 跳转到某页（宿主负责滚动 + 高亮定位） */
  onNavigate?: (hit: SearchHit, index: number) => void;
  /** 语言 */
  locale?: Locale;
  /** 文案覆盖 */
  messages?: Partial<Messages>;
}

/**
 * 搜索面板。
 *
 * @param props 参数
 */
export function SearchPanel(props: SearchPanelProps) {
  const { search, onClose, onNavigate, locale = 'zh', messages } = props;

  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  /** 上一次搜索的序号（丢弃过期结果） */
  const searchIdRef = useRef(0);

  const t = useCallback(
    (key: keyof Messages, vars?: Record<string, string | number>) =>
      resolveMessage(locale, key, messages, vars),
    [locale, messages],
  );

  /**
   * 执行搜索。
   *
   * core 的 `PdfSearch` 是**同步**搜索（索引建好后纯内存查找），
   * 但**首次搜索前要建索引**（异步、分片、会让出主线程）。
   *
   * 所以流程是：先确保索引建好（buildIndex）→ 再同步搜。
   * 用 searchId 丢弃过期结果，避免"慢的旧搜索覆盖快的新搜索"。
   */
  const runSearch = useCallback(
    async (next: string) => {
      if (!search || next.trim().length === 0) {
        setHits([]);
        return;
      }

      searchIdRef.current += 1;
      const searchId = searchIdRef.current;

      setSearching(true);
      try {
        // 索引没建好 → 先建（懒建：第一次搜索时才付出这个代价）
        const provider = search.getPageProvider();
        if (provider && !search.isComplete && search.indexedPages === 0) {
          await search.buildIndex(provider, search.getTotalPages());
        }

        if (searchIdRef.current !== searchId) {
          return;
        }

        const result = search.search(next);
        setHits(result);
        setActiveIndex(0);
      } catch {
        if (searchIdRef.current === searchId) {
          setHits([]);
        }
      } finally {
        if (searchIdRef.current === searchId) {
          setSearching(false);
        }
      }
    },
    [search],
  );

  // 输入变化 → 搜索
  useEffect(() => {
    void runSearch(keyword);
  }, [keyword, runSearch]);

  // 面板关闭 → 清空
  useEffect(() => {
    return () => {
      setHits([]);
      setKeyword('');
    };
  }, []);

  /** 跳到上一个/下一个命中 */
  const goTo = useCallback(
    (index: number) => {
      if (hits.length === 0) {
        return;
      }
      const normalized = ((index % hits.length) + hits.length) % hits.length;
      setActiveIndex(normalized);
      const hit = hits[normalized];
      if (hit) {
        onNavigate?.(hit, normalized);
      }
    },
    [hits, onNavigate],
  );

  return (
    <search className="scpdf-search">
      {/*
        不写 autoFocus：搜索面板打开时自动聚焦是常见做法，
        但对读屏器用户是干扰（会打断当前朗读）。
        宿主可通过 ref 自行聚焦，或用键盘快捷键触发（Ctrl+F）。
      */}
      <input
        type="search"
        className="scpdf-search__input"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
      />

      {searching ? <span className="scpdf-search__status">{t('load.loading')}</span> : null}

      {!searching && keyword.trim().length > 0 ? (
        <span className="scpdf-search__count">
          {hits.length > 0 ? t('search.count', { count: hits.length }) : t('search.none')}
        </span>
      ) : null}

      <button
        type="button"
        className="scpdf-toolbar__btn"
        onClick={() => goTo(activeIndex - 1)}
        disabled={hits.length === 0}
        aria-label={t('search.prev')}
        title={t('search.prev')}
      >
        ↑
      </button>

      <button
        type="button"
        className="scpdf-toolbar__btn"
        onClick={() => goTo(activeIndex + 1)}
        disabled={hits.length === 0}
        aria-label={t('search.next')}
        title={t('search.next')}
      >
        ↓
      </button>

      <button
        type="button"
        className="scpdf-toolbar__btn"
        onClick={onClose}
        aria-label={t('search.close')}
        title={t('search.close')}
      >
        ×
      </button>
    </search>
  );
}

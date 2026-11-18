'use client';
import { useState } from 'react';
import { Package, FolderOpen, Store, MapPin } from 'lucide-react';
import ManagementView from './management';
import { useAppSelector } from '@/store/store';

// 【合并入口】页签复用原CRUD，分别按权限显示；旧地址仍可访问。
export default function ManagementHub({
  mode,
  initialTab = '',
}: {
  mode: 'stores' | 'products';
  initialTab?: string;
}) {
  const permissions = useAppSelector((s) => s.auth.user?.permissions || []);
  const options =
    mode === 'stores'
      ? [
          { kind: 'stores' as const, name: '门店管理', permission: 'store:view' },
          { kind: 'regions' as const, name: '区域管理', permission: 'region:view' },
        ]
      : [
          { kind: 'products' as const, name: '商品管理', permission: 'product:view' },
          {
            kind: 'product-categories' as const,
            name: '商品分类',
            permission: 'product-category:view',
          },
        ];
  const allowed = options.filter((o) => permissions.includes(o.permission));
  const [selected, setSelected] = useState(initialTab);
  const [categoryId, setCategoryId] = useState('');
  const active = allowed.find((o) => o.kind === selected) || allowed[0];
  return (
    <>
      <div
        role="tablist"
        aria-label={mode === 'stores' ? '区域与门店' : '分类与商品'}
        className="mb-6 inline-flex gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-[0_1px_0_rgba(46,42,36,0.04)]"
      >
        {allowed.map((o) => (
          <button
            key={o.kind}
            role="tab"
            aria-selected={active?.kind === o.kind}
            onClick={() => setSelected(o.kind)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition sm:px-5 ${active?.kind === o.kind ? 'bg-orange-700 text-white shadow-sm' : 'text-ink-muted hover:bg-orange-50 dark:hover:bg-sunken'}`}
          >
            {o.kind === 'products' ? (
              <Package size={16} />
            ) : o.kind === 'product-categories' ? (
              <FolderOpen size={16} />
            ) : o.kind === 'stores' ? (
              <Store size={16} />
            ) : (
              <MapPin size={16} />
            )}
            {o.name}
          </button>
        ))}
      </div>
      {active ? (
        <ManagementView
          key={active.kind}
          kind={active.kind}
          initialCategoryId={categoryId}
          onCategoryChange={setCategoryId}
          onViewCategory={
            mode === 'products' && permissions.includes('product:view')
              ? (id) => {
                  setCategoryId(id);
                  setSelected('products');
                }
              : undefined
          }
        />
      ) : (
        <p>没有访问权限</p>
      )}
    </>
  );
}

'use client';

import { ProductThumbnail } from '@/components/product-thumbnail';
import { ProductStock } from '@/components/product-stock';
import {
  Plus,
  Power,
  Search,
  Pencil,
  Package,
  FolderOpen,
  ArrowRight,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  StatusTabs,
  Table,
  Td,
  Th,
  useToast,
} from '../components/ui';
import { useApi } from '../hooks/use-api';
import { api, errorMessage, type PageResult } from '../lib/api';
import { useAppSelector } from '../store/store';

type Entity = Record<string, any>;
type Kind = 'regions' | 'stores' | 'product-categories' | 'products';
// 商品状态标签页：key 对应后端 enabled 筛选值，空字符串代表全部商品
const PRODUCT_STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'true', label: '销售中' },
  { key: 'false', label: '仓库中' },
  { key: 'warning', label: '库存预警' },
  { key: 'recycled', label: '回收站' },
] as const;
const configs: Record<
  Kind,
  {
    title: string;
    description: string;
    endpoint: string;
    permission: string;
    columns: { key: string; label: string; render?: (row: Entity) => React.ReactNode }[];
  }
> = {
  regions: {
    title: '区域管理',
    description: '维护连锁经营区域及启用状态',
    endpoint: '/regions',
    permission: 'region:create',
    columns: [
      { key: 'code', label: '区域编码' },
      { key: 'name', label: '区域名称' },
      { key: 'stores', label: '门店数量', render: (r) => `${r._count?.stores || 0} 家` },
    ],
  },
  stores: {
    title: '门店管理',
    description: '统一维护门店档案、区域归属和经营状态',
    endpoint: '/stores',
    permission: 'store:create',
    columns: [
      { key: 'code', label: '门店编号' },
      { key: 'name', label: '门店名称' },
      { key: 'region', label: '所属区域', render: (r) => r.region?.name },
      { key: 'address', label: '地址' },
      {
        key: 'openedAt',
        label: '开业日期',
        render: (r) => new Date(r.openedAt).toLocaleDateString(),
      },
    ],
  },
  'product-categories': {
    title: '商品分类',
    description: '维护日用百货、数码配件和休闲食品等分类',
    endpoint: '/product-categories',
    permission: 'product-category:edit',
    columns: [
      { key: 'code', label: '分类编码' },
      { key: 'name', label: '分类名称' },
      { key: 'sort', label: '排序' },
      { key: 'products', label: '商品数量', render: (r) => `${r._count?.products || 0} 个` },
    ],
  },
  products: {
    title: '商品管理',
    description: '维护商品价格、成本、分类和上下架状态',
    endpoint: '/products',
    permission: 'product:create',
    columns: [
      {
        key: 'name',
        label: '商品信息',
        render: (r) => (
          <div className="flex min-w-48 items-center gap-3">
            <ProductThumbnail name={String(r.name)} imageUrl={r.imageUrl as string | null} />
            <div>
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-ink-muted">{r.code}</p>
            </div>
          </div>
        ),
      },
      { key: 'category', label: '分类', render: (r) => r.category?.name },
      {
        key: 'price',
        label: '售价 / 成本',
        render: (r) => (
          <div className="whitespace-nowrap">
            <p>¥{Number(r.price).toFixed(2)}</p>
            <p className="text-xs text-ink-muted">成本 ¥{Number(r.costPrice).toFixed(2)}</p>
          </div>
        ),
      },
      {
        key: 'stock',
        label: '库存',
        render: (r) =>
          r.stockOnHand == null ? (
            '未初始化'
          ) : (
            <span>
              {r.stockOnHand} / {r.stockReserved} / {r.stockOnHand - r.stockReserved}
            </span>
          ),
      },
      { key: 'salesQuantity', label: '净成交件数', render: (r) => String(r.salesQuantity ?? 0) },
    ],
  },
};
export default function ManagementPage({
  kind,
  initialCategoryId = '',
  initialState = '',
  onCategoryChange,
  onViewCategory,
}: {
  kind: Kind;
  initialCategoryId?: string;
  initialState?: string;
  onCategoryChange?: (id: string) => void;
  onViewCategory?: (id: string) => void;
}) {
  const config = configs[kind];
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [status, setStatus] = useState(initialState);
  const chooseCategory = (id: string) => {
    setCategoryId(id);
    setPage(1);
    onCategoryChange?.(id);
  };
  const [sort, setSort] = useState({ by: '', direction: 'asc' });
  const sortColumn = (by: string) => {
    setPage(1);
    setSort((s) => ({ by, direction: s.by === by && s.direction === 'asc' ? 'desc' : 'asc' }));
  };
  const paged = kind === 'stores' || kind === 'products';
  const url =
    config.endpoint +
    `?sortBy=${sort.by}&sortDirection=${sort.direction}&keyword=${encodeURIComponent(keyword)}${paged ? `&page=${page}&pageSize=20` : ''}${kind === 'products' ? `&categoryId=${encodeURIComponent(categoryId)}${status ? (['true', 'false'].includes(status) ? `&enabled=${status}` : `&state=${status}`) : ''}` : ''}`;
  const result = useApi<Entity[] | PageResult<Entity>>(url);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [stockTarget, setStockTarget] = useState<{ product: Entity; history: boolean } | null>(
    null,
  );
  const [recycleTarget, setRecycleTarget] = useState<Entity | null>(null);
  const [recycling, setRecycling] = useState(false);
  const [recycleError, setRecycleError] = useState('');
  // 拉取每个商品状态的总数（每类只请求 1 条拿 total，列表变化后自动刷新计数）
  useEffect(() => {
    if (kind !== 'products') return;
    let alive = true;
    Promise.all(
      PRODUCT_STATUS_TABS.map((tab) =>
        api
          .get<{ data: PageResult<Entity> }>(
            '/products?' +
              new URLSearchParams({
                page: '1',
                pageSize: '1',
                ...(tab.key
                  ? ['true', 'false'].includes(tab.key)
                    ? { enabled: tab.key }
                    : { state: tab.key }
                  : {}),
              }),
          )
          .then((res) => [tab.key, res.data.data.total] as const),
      ),
    )
      .then((entries) => {
        if (alive) setCounts(Object.fromEntries(entries));
      })
      .catch(() => {
        if (alive) setCounts(null);
      });
    return () => {
      alive = false;
    };
  }, [kind, result.data]);
  const user = useAppSelector((s) => s.auth.user)!;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Entity>({});
  const [editing, setEditing] = useState<Entity | null>(null);
  const [submitError, setSubmitError] = useState('');
  const { toast } = useToast();
  const regions = useApi<Entity[]>('/regions');
  const categories = useApi<Entity[]>('/product-categories');
  const items = useMemo(
    () => (Array.isArray(result.data) ? result.data : result.data?.items || []),
    [result.data],
  );
  const canCreate = user.permissions.includes(config.permission);
  const begin = (row?: Entity) => {
    setEditing(row || null);
    setSubmitError('');
    setForm(
      row
        ? {
            ...row,
            regionId: row.regionId,
            categoryId: row.categoryId,
            openedAt: String(row.openedAt || '').slice(0, 10),
          }
        : kind === 'stores'
          ? { enabled: true, openedAt: new Date().toISOString().slice(0, 10) }
          : kind === 'products'
            ? { enabled: true, price: 0, costPrice: 0, categoryId }
            : kind === 'product-categories'
              ? { enabled: true, sort: 0 }
              : { enabled: true },
    );
    setOpen(true);
  };
  const submit = async () => {
    setSubmitError('');
    if (
      !form.code?.trim() ||
      !form.name?.trim() ||
      (kind === 'stores' && (!form.regionId || !form.address || !form.openedAt)) ||
      (kind === 'products' &&
        (!form.categoryId || Number(form.price) < 0 || Number(form.costPrice) < 0))
    ) {
      setSubmitError('请填写所有必填字段，价格与成本不能为负数');
      return;
    }
    try {
      const endpoint = config.endpoint;
      const payload = {
        ...(kind === 'products'
          ? Object.fromEntries(
              ['code', 'name', 'categoryId', 'price', 'costPrice', 'imageUrl', 'enabled']
                .filter((key) => form[key] !== undefined)
                .map((key) => [key, form[key]]),
            )
          : form),
        ...(['products'].includes(kind)
          ? { price: Number(form.price), costPrice: Number(form.costPrice) }
          : {}),
        ...(kind === 'product-categories' ? { sort: Number(form.sort) } : {}),
      };
      if (editing) await api.patch(`${endpoint}/${editing.id}`, payload);
      else await api.post(endpoint, payload);
      setOpen(false);
      toast({ title: '保存成功', variant: 'success' });
      await result.reload();
    } catch (e) {
      const message = errorMessage(e);
      setSubmitError(message);
      toast({ title: '保存失败', description: message, variant: 'error' });
    }
  };
  const toggle = async (row: Entity) => {
    const endpoint = config.endpoint;
    try {
      if (kind === 'regions' || kind === 'stores' || kind === 'products')
        await api.patch(`${endpoint}/${row.id}/status`, { enabled: !row.enabled });
      else await api.patch(`${endpoint}/${row.id}`, { enabled: !row.enabled });
      toast({ title: `已${row.enabled ? '停用' : '启用'}`, variant: 'success' });
      await result.reload();
    } catch (e) {
      toast({ title: '状态更新失败', description: errorMessage(e), variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader
        title={config.title}
        description={
          kind === 'products' ? '按分类浏览商品，集中维护价格与上下架状态' : config.description
        }
        action={
          canCreate ? (
            <Button onClick={() => begin()}>
              <Plus size={16} />
              新增{config.title.replace('管理', '')}
            </Button>
          ) : undefined
        }
      />
      {kind === 'products' && (
        <StatusTabs
          tabs={PRODUCT_STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
          counts={counts}
          value={status}
          onChange={(key) => {
            setStatus(key);
            setPage(1);
          }}
        />
      )}
      {kind === 'products' && categories.data && (
        <div
          className="mb-5 flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="按商品分类筛选"
        >
          {[{ id: '', name: '全部商品' }, ...categories.data].map((category: Entity) => (
            <button
              key={category.id}
              aria-pressed={categoryId === category.id}
              onClick={() => chooseCategory(category.id)}
              className={`flex shrink-0 items-center gap-2 rounded-md border px-4 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-orange-600 ${categoryId === category.id ? 'border-orange-300 bg-orange-50 font-semibold text-orange-900' : 'border-line bg-surface text-ink-muted hover:border-orange-200 hover:bg-orange-50/50'}`}
            >
              {category.id ? <FolderOpen size={16} /> : <Package size={16} />}
              {category.name}
            </button>
          ))}
        </div>
      )}
      <Card className="p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-line pb-5 dark:border-line">
          <div className="relative min-w-0 flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-2.5 text-ink-faint" size={18} />
            <Input
              className="pl-9"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              placeholder="搜索编码或名称"
              aria-label="搜索编码或名称"
            />
          </div>
          {(keyword || (kind === 'products' && (categoryId || status))) && (
            <Button
              variant="ghost"
              onClick={() => {
                setKeyword('');
                setStatus('');
                chooseCategory('');
              }}
            >
              <RotateCcw size={15} />
              重置
            </Button>
          )}
          <Button
            variant="outline"
            className="sm:ml-auto"
            onClick={result.reload}
            disabled={result.loading}
          >
            <RefreshCw size={15} className={result.loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </div>
        {kind === 'products' && !result.loading && !result.error && (
          <p className="mb-4 text-xs text-ink-muted">
            {categoryId
              ? categories.data?.find((c) => c.id === categoryId)?.name || '当前分类'
              : '全部商品'}
            {' · '}
            {!Array.isArray(result.data) ? result.data?.total || 0 : items.length} 件商品
            {status ? ` · ${PRODUCT_STATUS_TABS.find((t) => t.key === status)?.label}` : ''}
            {' · 净成交件数：当前权限范围内已支付/已完成订单，整单退款不计入；仓库中指未上架'}
          </p>
        )}
        {result.loading ? (
          <LoadingState />
        ) : result.error ? (
          <ErrorState message={result.error} retry={result.reload} />
        ) : !items.length ? (
          <EmptyState />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {config.columns.map((c) => (
                    <Th
                      key={c.key}
                      onSort={
                        kind === 'products' &&
                        ['name', 'category', 'price', 'costPrice'].includes(c.key)
                          ? () => sortColumn(c.key)
                          : undefined
                      }
                      direction={sort.by === c.key ? sort.direction : undefined}
                    >
                      {c.label}
                    </Th>
                  ))}
                  <Th>状态</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="hover:bg-sunken/70 dark:hover:bg-sunken/70">
                    {config.columns.map((c) => (
                      <Td key={c.key}>
                        {kind === 'product-categories' &&
                        onViewCategory &&
                        ['name', 'products'].includes(c.key) ? (
                          <button
                            className="inline-flex items-center gap-2 font-medium text-orange-800 underline-offset-4 hover:underline dark:text-orange-300"
                            onClick={() => onViewCategory(row.id)}
                            aria-label={`查看${row.name}的商品`}
                          >
                            {c.render ? c.render(row) : String(row[c.key] ?? '-')}
                            <ArrowRight size={13} />
                          </button>
                        ) : c.render ? (
                          c.render(row)
                        ) : (
                          String(row[c.key] ?? '-')
                        )}
                      </Td>
                    ))}
                    <Td>
                      <span className="whitespace-nowrap">
                        <Badge tone={row.enabled ? 'green' : 'neutral'}>
                          {row.deletedAt
                            ? '回收站'
                            : kind === 'products'
                              ? row.enabled
                                ? '已上架'
                                : '已下架'
                              : row.enabled
                                ? '启用'
                                : '停用'}
                        </Badge>
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        {kind === 'products' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost">
                                更多
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                onSelect={() => setStockTarget({ product: row, history: true })}
                              >
                                库存记录
                              </DropdownMenuItem>
                              {user.permissions.includes('product:edit') && (
                                <>
                                  {!row.deletedAt && (
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setStockTarget({ product: row, history: false })
                                      }
                                    >
                                      库存调整
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setRecycleTarget(row);
                                      setRecycleError('');
                                    }}
                                  >
                                    {row.deletedAt ? '恢复商品' : '移入回收站'}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {!row.deletedAt &&
                          (kind !== 'products' || user.permissions.includes('product:edit')) && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => begin(row)}>
                                <Pencil size={13} />
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className={
                                  row.enabled ? 'text-ink-muted hover:text-brick' : 'text-tea'
                                }
                                onClick={() => toggle(row)}
                              >
                                <Power size={14} />
                                {kind === 'products'
                                  ? row.enabled
                                    ? '下架'
                                    : '上架'
                                  : row.enabled
                                    ? '停用'
                                    : '启用'}
                              </Button>
                            </>
                          )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {paged && !Array.isArray(result.data) && result.data && (
              <Pagination
                page={page}
                pageSize={20}
                total={result.data.total}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </Card>
      {stockTarget && (
        <ProductStock
          product={stockTarget.product as { id: string; name: string }}
          history={stockTarget.history}
          onClose={() => setStockTarget(null)}
          onSaved={() => void result.reload()}
        />
      )}
      <Dialog
        open={!!recycleTarget}
        onOpenChange={(value) => {
          if (!value && !recycling) setRecycleTarget(null);
        }}
        title={recycleTarget?.deletedAt ? '恢复商品' : '移入回收站'}
      >
        <p>
          商品 {recycleTarget?.name}：
          {recycleTarget?.deletedAt
            ? '恢复后保持下架，库存与历史记录保留。'
            : '仅软删除，不删除订单快照。有效秒杀或库存占用会阻止回收。'}
        </p>
        {recycleError && <p role="alert">{recycleError}</p>}
        <Button
          disabled={recycling}
          onClick={async () => {
            if (!recycleTarget || recycling) return;
            setRecycling(true);
            try {
              await api.post(
                '/products/' +
                  recycleTarget.id +
                  (recycleTarget.deletedAt ? '/restore' : '/recycle'),
              );
              setRecycleTarget(null);
              void result.reload();
            } catch (e) {
              setRecycleError(errorMessage(e));
            } finally {
              setRecycling(false);
            }
          }}
        >
          确认
        </Button>
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${editing ? '编辑' : '新增'}${config.title.replace('管理', '')}`}
        description="编码、名称及业务关联字段为必填项"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields(kind).map((field) => (
            <label key={field.key} className={field.full ? 'sm:col-span-2' : ''}>
              <span className="mb-1.5 block text-sm font-medium">{field.label}</span>
              {field.type === 'select' ? (
                <Select
                  className="w-full"
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                >
                  <option value="">请选择</option>
                  {(field.key === 'regionId' ? regions.data || [] : categories.data || []).map(
                    (o: Entity) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ),
                  )}
                </Select>
              ) : (
                <Input
                  type={field.type || 'text'}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
        {submitError && (
          <div className="mt-4 rounded-lg bg-brick-tint p-3 text-sm text-brick  ">
            {submitError}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </div>
      </Dialog>
    </>
  );
}
function fields(kind: Kind) {
  if (kind === 'regions')
    return [
      { key: 'code', label: '区域编码' },
      { key: 'name', label: '区域名称' },
    ];
  if (kind === 'stores')
    return [
      { key: 'code', label: '门店编号' },
      { key: 'name', label: '门店名称' },
      { key: 'regionId', label: '所属区域', type: 'select' },
      { key: 'phone', label: '联系电话' },
      { key: 'address', label: '门店地址', full: true },
      { key: 'openedAt', label: '开业日期', type: 'date' },
    ];
  if (kind === 'product-categories')
    return [
      { key: 'code', label: '分类编码' },
      { key: 'name', label: '分类名称' },
      { key: 'sort', label: '排序', type: 'number' },
    ];
  return [
    { key: 'code', label: '商品编号' },
    { key: 'name', label: '商品名称' },
    { key: 'categoryId', label: '商品分类', type: 'select' },
    { key: 'price', label: '售价', type: 'number' },
    { key: 'costPrice', label: '成本价', type: 'number' },
    { key: 'imageUrl', label: '图片URL', full: true },
  ];
}

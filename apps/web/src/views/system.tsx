'use client';

import { Info, Plus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Badge,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  Tooltip,
} from '../components/ui';
import { useApi } from '../hooks/use-api';
import { api, errorMessage, type PageResult } from '../lib/api';
type Row = Record<string, any>;

// 用户状态标签页：key 对应 enabled 布尔值，空字符串代表全部用户
const USER_STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'true', label: '启用' },
  { key: 'false', label: '禁用' },
] as const;

export function MetricsPage() {
  const r = useApi<Row[]>('/metrics/definitions');
  const toggle = async (x: Row) => {
    try {
      await api.patch(`/metrics/definitions/${x.id}/status`, { enabled: !x.enabled });
      await r.reload();
    } catch (e) {
      window.console.error(errorMessage(e));
    }
  };
  return (
    <List
      title="指标口径"
      description="查看指标定义与计算说明；当前开关维护定义状态，不改变经营总览的固定统计计算"
      state={r}
      headers={['指标', '业务口径', '计算公式', '状态', '操作']}
      render={(x) => (
        <>
          <Td>
            <div className="font-medium">{x.name}</div>
            <div className="text-xs text-ink-faint">{x.code}</div>
          </Td>
          <Td>{x.description}</Td>
          <Td>
            <div className="flex items-center gap-2">
              <code className="rounded bg-sunken px-2 py-1 text-xs dark:bg-sunken">
                {x.formula}
              </code>
              <Tooltip content={`指标公式：${x.formula}。${x.description || ''}`}>
                <button aria-label={`${x.name}公式说明`}>
                  <Info size={15} />
                </button>
              </Tooltip>
            </div>
          </Td>
          <Td>
            <Badge tone={x.enabled ? 'green' : 'neutral'}>{x.enabled ? '启用' : '停用'}</Badge>
          </Td>
          <Td>
            <Button size="sm" variant="outline" onClick={() => toggle(x)}>
              {x.enabled ? '停用' : '启用'}
            </Button>
          </Td>
        </>
      )}
    />
  );
}

export function UsersPage() {
  const users = useApi<Row[]>('/system/users');
  const roles = useApi<Row[]>('/system/roles');
  const regions = useApi<Row[]>('/regions');
  const stores = useApi<PageResult<Row>>('/stores?pageSize=100');
  const [status, setStatus] = useState('');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  // 【状态筛选与计数】用户接口一次性返回全量数组，直接在前端按启用状态过滤并统计各状态数量。
  const data = users.data ?? [];
  const filtered = data.filter((x) => (status ? String(x.enabled) === status : true));
  useEffect(() => {
    if (!users.data) return;
    const list = users.data;
    const tally: Record<string, number> = { '': list.length };
    USER_STATUS_TABS.forEach((tab) => {
      if (tab.key) tally[tab.key] = list.filter((x) => String(x.enabled) === tab.key).length;
    });
    setCounts(tally);
  }, [users.data]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});
  const [error, setError] = useState('');
  const begin = (row?: Row) => {
    setEditing(row || null);
    setForm(
      row
        ? {
            name: row.name,
            email: row.email || '',
            phone: row.phone || '',
            regionId: row.regionId || '',
            storeId: row.storeId || '',
            roleId: row.roles[0]?.roleId || '',
            enabled: row.enabled,
          }
        : {
            username: '',
            name: '',
            email: '',
            phone: '',
            password: 'Sunny@123456',
            regionId: '',
            storeId: '',
            roleId: '',
          },
    );
    setError('');
    setOpen(true);
  };
  const submit = async () => {
    setError('');
    try {
      if (editing) await api.patch(`/system/users/${editing.id}`, form);
      else await api.post('/system/users', form);
      setOpen(false);
      await users.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const toggle = async (row: Row) => {
    await api.patch(`/system/users/${row.id}`, { enabled: !row.enabled });
    await users.reload();
  };
  return (
    <>
      <PageHeader
        title="用户管理"
        description="新增用户、分配角色和区域/门店数据范围"
        action={
          <Button onClick={() => begin()}>
            <Plus size={16} />
            新增用户
          </Button>
        }
      />
      <StatusTabs
        tabs={USER_STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        counts={counts}
        value={status}
        onChange={setStatus}
      />
      <Card className="p-5">
        {status && (
          <div className="mb-4">
            <Button variant="ghost" onClick={() => setStatus('')}>
              <RotateCcw size={15} />
              重置
            </Button>
          </div>
        )}
        {users.loading ? (
          <LoadingState />
        ) : users.error ? (
          <ErrorState message={users.error} retry={users.reload} />
        ) : !filtered.length ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>用户</Th>
                <Th>联系方式</Th>
                <Th>数据范围</Th>
                <Th>角色</Th>
                <Th>状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id}>
                  <Td>
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-ink-faint">@{x.username}</div>
                  </Td>
                  <Td>{x.email || x.phone || '-'}</Td>
                  <Td>{x.store?.name || x.region?.name || '全部数据'}</Td>
                  <Td>{x.roles.map((r: any) => r.role.name).join('、') || '-'}</Td>
                  <Td>
                    <Badge tone={x.enabled ? 'green' : 'neutral'}>
                      {x.enabled ? '启用' : '禁用'}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => begin(x)}>
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(x)}>
                        {x.enabled ? '禁用' : '启用'}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title={editing ? '编辑用户' : '新增用户'}>
        <div className="grid grid-cols-2 gap-4">
          {!editing && (
            <Field label="用户名">
              <Input
                value={form.username || ''}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </Field>
          )}
          <Field label="姓名">
            <Input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="邮箱">
            <Input
              type="email"
              value={form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="电话">
            <Input
              value={form.phone || ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label={editing ? '重置密码（不修改请留空）' : '初始密码'}>
            <Input
              value={form.password || ''}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="角色">
            <Select
              className="w-full"
              value={form.roleId || ''}
              onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            >
              <option value="">请选择</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="所属区域">
            <Select
              className="w-full"
              value={form.regionId || ''}
              onChange={(e) => setForm({ ...form, regionId: e.target.value })}
            >
              <option value="">全部/无</option>
              {regions.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="所属门店">
            <Select
              className="w-full"
              value={form.storeId || ''}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
            >
              <option value="">全部/无</option>
              {stores.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <FormError text={error} />}
        <Actions close={() => setOpen(false)} submit={submit} />
      </Dialog>
    </>
  );
}

export function RolesPage() {
  const roles = useApi<Row[]>('/system/roles');
  const permissions = useApi<Row[]>('/system/permissions');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({ permissionIds: [] });
  const [error, setError] = useState('');
  const begin = (row?: Row) => {
    setEditing(row || null);
    setForm(
      row
        ? {
            code: row.code,
            name: row.name,
            description: row.description || '',
            dataScope: row.dataScope,
            permissionIds: row.permissions.map((p: any) => p.permissionId),
          }
        : { code: '', name: '', description: '', dataScope: 'ALL', permissionIds: [] },
    );
    setError('');
    setOpen(true);
  };
  const togglePermission = (id: string) =>
    setForm({
      ...form,
      permissionIds: form.permissionIds.includes(id)
        ? form.permissionIds.filter((x: string) => x !== id)
        : [...form.permissionIds, id],
    });
  const submit = async () => {
    setError('');
    try {
      if (editing) await api.patch(`/system/roles/${editing.id}`, form);
      else await api.post('/system/roles', form);
      setOpen(false);
      await roles.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader
        title="角色权限"
        description="配置菜单、按钮权限和数据范围"
        action={
          <Button onClick={() => begin()}>
            <Plus size={16} />
            新增角色
          </Button>
        }
      />
      <Card className="p-5">
        {roles.loading ? (
          <LoadingState />
        ) : roles.error ? (
          <ErrorState message={roles.error} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>角色</Th>
                <Th>编码</Th>
                <Th>数据范围</Th>
                <Th>用户数</Th>
                <Th>权限数量</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {roles.data?.map((x) => (
                <tr key={x.id}>
                  <Td>
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-ink-faint">{x.description}</div>
                  </Td>
                  <Td>
                    <code>{x.code}</code>
                  </Td>
                  <Td>
                    <Badge tone="blue">
                      {
                        ({ ALL: '全部数据', REGION: '所属区域', STORE: '所属门店' } as any)[
                          x.dataScope
                        ]
                      }
                    </Badge>
                  </Td>
                  <Td>{x._count.users}</Td>
                  <Td>{x.permissions.length}</Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => begin(x)}>
                      配置权限
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title={editing ? '编辑角色权限' : '新增角色'}>
        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="permissions">权限配置</TabsTrigger>
          </TabsList>
          <TabsContent value="basic">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="角色编码">
                <Input
                  value={form.code || ''}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
              <Field label="角色名称">
                <Input
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="数据范围">
                <Select
                  className="w-full"
                  value={form.dataScope}
                  onChange={(e) => setForm({ ...form, dataScope: e.target.value })}
                >
                  <option value="ALL">全部数据</option>
                  <option value="REGION">所属区域</option>
                  <option value="STORE">所属门店</option>
                </Select>
              </Field>
              <Field label="角色说明">
                <Input
                  value={form.description || ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>
          </TabsContent>
          <TabsContent value="permissions">
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-auto rounded-xl border border-line p-3 dark:border-line sm:grid-cols-2">
              {permissions.data?.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-sunken dark:hover:bg-sunken"
                >
                  <input
                    type="checkbox"
                    checked={form.permissionIds.includes(p.id)}
                    onChange={() => togglePermission(p.id)}
                  />
                  <span>{p.name}</span>
                  <code className="ml-auto text-[10px] text-ink-faint">{p.code}</code>
                </label>
              ))}
            </div>
          </TabsContent>
        </Tabs>
        {error && <FormError text={error} />}
        <Actions close={() => setOpen(false)} submit={submit} />
      </Dialog>
    </>
  );
}

export function LogsPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const r = useApi<PageResult<Row>>(
    `/system/logs?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`,
  );
  return (
    <>
      <PageHeader title="操作日志" description="记录登录、数据维护、导入和权限操作" />
      <Card className="p-5">
        <div className="relative mb-4 max-w-72">
          <Search size={17} className="absolute left-3 top-3 text-ink-faint" />
          <Input
            className="pl-9"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="搜索用户、模块或操作"
          />
        </div>
        {r.loading ? (
          <LoadingState />
        ) : r.error ? (
          <ErrorState message={r.error} retry={r.reload} />
        ) : !r.data?.items.length ? (
          <EmptyState />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {['时间', '用户', '模块', '操作', '结果', 'IP地址'].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.data.items.map((x) => (
                  <tr key={x.id}>
                    <Td>{new Date(x.createdAt).toLocaleString()}</Td>
                    <Td>{x.user?.name || '匿名/系统'}</Td>
                    <Td>{x.module}</Td>
                    <Td>
                      <code className="text-xs">{x.action}</code>
                    </Td>
                    <Td>
                      <Badge tone={x.success ? 'green' : 'red'}>
                        {x.success ? '成功' : '失败'}
                      </Badge>
                    </Td>
                    <Td>{x.ip || '-'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={20} total={r.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
function List({
  title,
  description,
  state,
  headers,
  render,
}: {
  title: string;
  description: string;
  state: { data: Row[] | null; loading: boolean; error: string; reload: () => unknown };
  headers: string[];
  render: (r: Row) => React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="p-5">
        {state.loading ? (
          <LoadingState />
        ) : state.error ? (
          <ErrorState message={state.error} retry={state.reload} />
        ) : !state.data?.length ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.map((r) => (
                <tr key={r.id}>{render(r)}</tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
function FormError({ text }: { text: string }) {
  return <div className="mt-4 rounded-lg bg-brick-tint p-3 text-sm text-brick">{text}</div>;
}
function Actions({ close, submit }: { close: () => void; submit: () => void }) {
  return (
    <div className="mt-6 flex justify-end gap-3">
      <Button variant="outline" onClick={close}>
        取消
      </Button>
      <Button onClick={submit}>保存</Button>
    </div>
  );
}

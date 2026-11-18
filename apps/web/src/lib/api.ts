import axios from 'axios';

export type ApiResponse<T> = { code: number; message: string; data: T; requestId: string };
export type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number };

export const api = axios.create({ baseURL: '/api/v1', timeout: 15000, withCredentials: true }); // 跨域请求允许携带cookie
api.interceptors.response.use(
  // 响应拦截器，每次请求成功回到response，失败进入error
  (response) => response,
  (error) => {
    // 【演示过期】仅响应隔离网关的明确标记，返回入口重新分配干净环境。
    if (typeof window !== 'undefined' && error.response?.headers?.['x-demo-expired'] === '1') {
      window.location.href = '/';
      return Promise.reject(error);
    }
    if (
      typeof window !== 'undefined' && //判断在不在浏览器
      error.response?.status === 401 && //判断是否是401错误码
      !window.location.pathname.endsWith('/login') //判断是否是登录页
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export const errorMessage = (error: unknown) =>
  axios.isAxiosError(error)
    ? error.response?.data?.message || error.message
    : '操作失败，请稍后重试';

import type { Project } from '@protocol/v2/Project';
import type { Thread } from '@protocol/v2/Thread';
import type { ThreadListParams } from '@protocol/v2/ThreadListParams';

export interface ProjectListResponse {
  data: Project[];
  nextCursor: string | null;
}

export interface ProjectCreateResponse {
  project: Project;
}

export interface ProjectUpdateResponse {
  project: Project;
}

export interface ProjectDeleteResponse {
  [key: string]: never;
}

export interface ThreadSearchResponse {
  data: Array<{ thread: Thread; snippet: string }>;
  nextCursor: string | null;
}

/// `thread/list` 请求参数。
///
/// 生成类型剔除 experimental 字段，这里按 Rust 定义补齐桌面端依赖的字段，字段名同 wire 名。
/// app-server 反序列化请求参数时忽略未知字段，字段名写错不会报错，只会静默丢掉过滤条件，
/// 因此调用点用 `satisfies ThreadListRequestParams` 覆盖检查。
export type ThreadListRequestParams = ThreadListParams & {
  /// 会话树祖先线程 id；返回该线程的全部后代，不含自身。与 `parentThreadId` 互斥。
  /// 对应 workx-rs/app-server-protocol/src/protocol/v2/thread.rs 的 `ancestor_thread_id`。
  ancestorThreadId?: string | null;
};

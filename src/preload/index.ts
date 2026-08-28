import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ShowRequest } from '../shared/ipc.js';

/**
 * 렌더러에 노출하는 최소 API.
 *
 * 오버레이는 신뢰할 수 없는 콘텐츠를 띄우지 않지만, 그래도
 * contextIsolation을 켜고 필요한 채널만 연다.
 */
const api = {
  onShow(cb: (req: ShowRequest) => void): () => void {
    const handler = (_e: unknown, req: ShowRequest): void => cb(req);
    ipcRenderer.on(IPC.show, handler);
    return () => ipcRenderer.off(IPC.show, handler);
  },
  onHide(cb: () => void): () => void {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.hide, handler);
    return () => ipcRenderer.off(IPC.hide, handler);
  },
  /** 말풍선 위에 마우스가 올라왔을 때만 클릭을 받는다. */
  setInteractive(interactive: boolean): void {
    ipcRenderer.send(IPC.setInteractive, interactive);
  },
  dismissed(id: number): void {
    ipcRenderer.send(IPC.dismissed, id);
  },
};

contextBridge.exposeInMainWorld('overlay', api);

export type OverlayApi = typeof api;

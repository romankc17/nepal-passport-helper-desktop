import { BrowserWindow, Menu, Tray, nativeImage } from 'electron';

// Placeholder tray icon: 16x16 navy square with a white "P", generated
// offline as a PNG data URI so no asset files are needed yet.
const TRAY_ICON_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR4nGPgV3H4TwlmGHwG4AIUG4DLIJwGECtOOwMo9gLFgUhxNA5hA0jFA28AAOa34ciANQ3eAAAAAElFTkSuQmCC';

export interface TrayDeps {
  getWindow: () => BrowserWindow | null;
  onQuit: () => void;
}

export function createTray(deps: TrayDeps): Tray {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URI);
  if (process.platform === 'darwin') icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip('Nepal Passport Helper');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        const win = deps.getWindow();
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => deps.onQuit() },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    const win = deps.getWindow();
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  return tray;
}

@Observed
export class SettingsConfirmation {
  title: string = '';
  message: string = '';
  acceptLabel: string = '确认';
  cancelLabel: string = '取消';
  private resolve?: (accepted: boolean) => void;
  private openDialog: () => void;
  private closeDialog: () => void;

  constructor(openDialog: () => void, closeDialog: () => void) {
    this.openDialog = openDialog; this.closeDialog = closeDialog;
  }

  ask(title: string, message: string, acceptLabel: string, cancelLabel: string = '取消'): Promise<boolean> {
    if (this.resolve) this.settle(false);
    this.title = title; this.message = message; this.acceptLabel = acceptLabel; this.cancelLabel = cancelLabel;
    return new Promise<boolean>((resolve) => { this.resolve = resolve; this.openDialog(); });
  }

  settle(accepted: boolean): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    if (!resolve) return;
    this.closeDialog();
    resolve(accepted);
  }
}

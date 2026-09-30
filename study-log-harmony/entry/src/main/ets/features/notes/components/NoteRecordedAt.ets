import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { beijingNoteTimestamp, notePickerDate } from '../NoteTime';

@Component
export struct NoteRecordedAt {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @Prop value: string = '';
  @Prop editable: boolean = true;
  onChange: (value: string) => void = () => {};

  private choose(): void {
    const current = notePickerDate(this.value);
    this.getUIContext().showDatePickerDialog({
      selected: current, end: notePickerDate(beijingNoteTimestamp()),
      onDateAccept: (day: Date) => {
        this.getUIContext().showTimePickerDialog({
          selected: current, useMilitaryTime: true,
          onAccept: (time: TimePickerResult) => {
            const pad = (part: number): string => part.toString().padStart(2, '0');
            const selected = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(time.hour)}:${pad(time.minute)}:00+08:00`;
            this.onChange(Date.parse(selected) > Date.now() ? beijingNoteTimestamp() : selected);
          }
        });
      }
    });
  }

  build() {
    Row({ space: 8 }) {
    Text('记录时间').fontSize(11).fontColor($r('app.color.muted'))
    if (this.breakpoint === WorkspaceBreakpoint.COMPACT) {
      Blank()
    }
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.calendar')).fontSize(16).fontColor([$r('app.color.muted')])
        Text(this.value.slice(0, 16).replace('T', ' ')).fontSize(12).fontColor($r('app.color.body')).maxLines(1)
      }
    }.height(36).padding({ left: 12, right: 12 }).id('note_recorded_at')
      .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(8).clip(true)
      .enabled(this.editable).accessibilityText('修改记录日期和时间').onClick(() => this.choose())
    }.width(this.breakpoint === WorkspaceBreakpoint.COMPACT ? '100%' : 230)
      .justifyContent(FlexAlign.End).alignItems(VerticalAlign.Center)
  }
}

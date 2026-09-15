import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';

const Dialog = DialogPrimitive;

function DialogContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Popup
      className={cn(
        'w-full max-w-lg border-2 border-foreground bg-popover p-5 shadow-2xl sm:p-7',
        className,
      )}
      {...props}
    />
  );
}

export { Dialog, DialogContent };

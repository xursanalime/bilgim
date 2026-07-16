// ═════════════════════════════════════════════════════════════════
// Bilgim UI primitive library — barrel export.
//
// Documented, themeable (light + dark via semantic tokens), keyboard-
// accessible primitives built on Radix + class-variance-authority + cn.
// Import from a single place:
//
//   import { Button, Card, Dialog, Tabs } from '@/components/ui';
//
// Existing relative imports (e.g. `../ui/button`) keep working too.
// ═════════════════════════════════════════════════════════════════

// Buttons & actions
export { Button, buttonVariants, type ButtonProps } from './button';

// Form inputs
export {
  Input,
  Textarea,
  inputVariants,
  type InputProps,
  type TextareaProps,
} from './input';
export { Label, FormField } from './form-field';
export { Select, selectVariants, type SelectProps } from './select';
export { Switch, type SwitchProps } from './switch';
export { Checkbox, type CheckboxProps } from './checkbox';
export { RadioCard, type RadioCardProps } from './radio-card';

// Surfaces
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  StatCard,
  cardVariants,
  type CardProps,
  type StatCardProps,
} from './card';

// Navigation
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabsProps,
  type TabsTriggerProps,
  type TabsContentProps,
} from './tabs';
export {
  Stepper,
  type StepperProps,
  type Step,
} from './stepper';

// Overlays
export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Modal,
  ModalContent,
  ModalTrigger,
  type DialogContentProps,
} from './dialog';
export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPortal,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetClose,
  type DrawerContentProps,
} from './drawer';
export { Tooltip, type TooltipProps } from './tooltip';

// Feedback
export { Toaster, toast, type ToasterProps } from './toast';
export { Skeleton, skeletonVariants, type SkeletonProps } from './skeleton';
export { EmptyState, emptyStateVariants, type EmptyStateProps } from './empty-state';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export { CircularProgress, type CircularProgressProps } from './circular-progress';

// Data display
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  SortableHead,
  type SortableHeadProps,
  type SortDirection,
} from './table';
export {
  Badge,
  StatusPill,
  badgeVariants,
  type BadgeProps,
  type StatusPillProps,
} from './badge';
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  avatarVariants,
  type AvatarProps,
} from './avatar';

// Protected media (content protection primitives — owned elsewhere, re-exported for convenience)
export { Lightbox } from './lightbox';
export {
  ProtectedImage,
  ProtectedAudio,
  ProtectedLightbox,
  ProtectedPdfViewer,
} from './protected-media';

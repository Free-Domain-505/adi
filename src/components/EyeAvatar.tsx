interface EyeAvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<EyeAvatarProps['size']>, string> = {
  sm: 'size-9 rounded-xl',
  md: 'size-11 rounded-xl',
  lg: 'size-20 rounded-2xl',
  xl: 'size-24 rounded-2xl',
};

export function EyeAvatar({ size = 'sm', className = '' }: EyeAvatarProps) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-canvas ring-1 ring-amber-400/50 shadow-md ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src="/assets/aistudio/IMAGE_2026-11-18_18_43_48_baa5e1b5.jpg"
        alt="Anime by Adi 💀"
        className="h-full w-full object-cover object-[35%_95%] scale-[1.45] origin-[34%_84%]"
      />
    </div>
  );
}

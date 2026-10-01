import { iconPath, type IconId } from '@/lib/pixel/icons';

/**
 * A 16×16 pixel icon, sized like a lucide icon by the same classes, so the
 * rail can swap one for the other without the layout noticing.
 */
export function PixelIcon({ id, className, title }: { id: IconId; className?: string; title?: string }) {
    return (
        <svg
            viewBox="0 0 16 16"
            className={className}
            fill="currentColor"
            shapeRendering="crispEdges"
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : undefined}
        >
            {title && <title>{title}</title>}
            <path d={iconPath(id)} />
        </svg>
    );
}

'use client';

import { useEffect } from 'react';

/**
 * useContentProtection — dars sahifalarida kontent o'g'irlanishini oldini oladi.
 *
 * Nima qiladi:
 *  - O'ng tugma (contextmenu) o'chiriladi
 *  - Ctrl/Cmd+S (saqlash), Ctrl/Cmd+U (manba), Ctrl/Cmd+P (print),
 *    F12, Ctrl+Shift+I/J/C (DevTools) bloklanydi
 *  - Ctrl+A (hammani tanlash), Ctrl+C (nusxa) videodan bloklanydi
 *  - Drag-and-drop o'chiriladi
 *  - DevTools ochilib qolsa ogohlantirish chiqadi va kontent yashiriladi
 *
 * HALOL CHEKLOV / HONEST LIMIT: bu chora real xavfsizlik emas — veb-brauzerda
 * skrinshot/ekran yozuvini 100% to'sib bo'lmaydi. Bu faqat tasodifiy
 * o'g'irlikni qiyinlashtiruvchi deterrent qatlam; haqiqiy himoya DRM + suvli
 * belgi (watermark) orqali kuzatuvchanlikka tayanadi.
 *
 * @param options.enabled — `false` bo'lsa hech qanday global tinglovchi
 *   ulanmaydi (masalan, himoyalanmagan ko'rib chiqish uchun). Default `true`,
 *   shuning uchun mavjud chaqiruvchilar avvalgidek ishlaydi (orqaga moslik).
 */
export function useContentProtection(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Saqlash, manba kodi, print
      if (ctrl && ['s', 'u', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Hammani tanlash, nusxa olish
      if (ctrl && ['a', 'c'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // DevTools: F12, Ctrl+Shift+I/J/C
      if (e.key === 'F12') {
        e.preventDefault();
        return;
      }
      if (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        return;
      }

      // Print Screen
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        // Clipboard ni tozalaymiz (ba'zi brauzerlarda ishlaydi)
        navigator.clipboard?.writeText('').catch(() => {});
        return;
      }
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('selectstart', handleSelectStart, true);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('dragstart', handleDragStart, true);
      document.removeEventListener('selectstart', handleSelectStart, true);
    };
  }, [enabled]);
}

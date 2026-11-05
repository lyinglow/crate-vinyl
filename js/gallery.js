// The pictures of a record: Discogs images, then your own sleeve and label photos.
import { photoUrl } from './store.js';

export function gallerySlides(rec) {
  const slides = [];
  const imgs = (rec.images || []).map((i) => i.uri).filter(Boolean);
  if (imgs.length) imgs.forEach((u) => slides.push({ src: u }));
  else if (rec.cover || rec.thumb) slides.push({ src: rec.cover || rec.thumb });
  if (rec.photoSleeve) slides.push({ photo: rec.photoSleeve });
  if (rec.photoLabel) slides.push({ photo: rec.photoLabel });
  return slides;
}

export async function slideUrl(slide) {
  if (!slide) return '';
  if (slide.src) return slide.src;
  return slide.photo ? photoUrl(slide.photo) : '';
}

export function preload(url) {
  if (!url) return;
  const im = new Image();
  im.referrerPolicy = 'no-referrer';
  im.src = url;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;
export const BUTTON_ZOOM_STEP = 0.25;
export const WHEEL_ZOOM_FACTOR = 1.08;

export const RATIOS = [
  { label: '自由', value: 'free', aspect: undefined as number | undefined },
  { label: '16:9', value: '16:9', aspect: 16 / 9 },
  { label: '16:10', value: '16:10', aspect: 16 / 10 },
  { label: '4:3', value: '4:3', aspect: 4 / 3 },
  { label: '1:1', value: '1:1', aspect: 1 },
  { label: '3:2', value: '3:2', aspect: 3 / 2 },
  { label: '2:3', value: '2:3', aspect: 2 / 3 },
  { label: '21:9', value: '21:9', aspect: 21 / 9 },
];

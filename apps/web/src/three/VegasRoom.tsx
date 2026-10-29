import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { VEGAS } from './vegasLayout';
export function preloadVegasRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(VEGAS, quality); }
export default function VegasRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={VEGAS} quality={quality} handNo={handNo} />;
}

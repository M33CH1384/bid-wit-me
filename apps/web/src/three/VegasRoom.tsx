import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { VEGAS } from './vegasLayout';
export function preloadVegasRoom(): void { preloadCubeVenue(VEGAS); }
export default function VegasRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={VEGAS} quality={quality} handNo={handNo} />;
}

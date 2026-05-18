import cities from '../data/cities.json';

/**
 * Haversine formula to calculate distance in KM between two points
 */
export const getDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d.toFixed(1);
};

/**
 * Find nearest city from the local dataset of 7,000+ Indian cities
 */
export const findNearestCity = (lat, lng) => {
  if (!lat || !lng) return "Unknown Location";
  let minDistance = Infinity;
  let nearestCity = "India";
  
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    // Simple Euclidean squared distance for fast iteration
    const dy = lat - city.latitude;
    const dx = lng - city.longitude;
    const distSq = dx * dx + dy * dy;
    
    if (distSq < minDistance) {
      minDistance = distSq;
      nearestCity = `${city.city}, ${city.state}`;
    }
    // Optimization: if we find an extremely close match (< 100m approx), stop
    if (minDistance < 0.0001) break; 
  }
  return nearestCity;
};
export const findCityCoords = (cityName) => {
  if (!cityName || cityName.toLowerCase() === 'n/a') return null;
  const lowerCity = cityName.toLowerCase().trim();
  const match = cities.find(c => 
    c.city.toLowerCase() === lowerCity || 
    lowerCity.includes(c.city.toLowerCase())
  );
  return match ? { lat: match.latitude, lng: match.longitude } : null;
};

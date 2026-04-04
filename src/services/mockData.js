'use strict';

/**
 * Mock Ambient Weather API client for development without hardware.
 * Generates realistic-looking sinusoidal temperature data.
 * Enable with: USE_MOCK_DATA=true
 */
class MockAmbientWeatherApi {
    async deviceData(macAddress, options = {}) {
        const limit = options.limit || 1;
        const endDate = options.endDate || Date.now();
        const startDate = options.startDate || (endDate - limit * 5 * 60 * 1000);
        const interval = options.startDate
            ? Math.floor((endDate - startDate) / Math.max(limit - 1, 1))
            : 5 * 60 * 1000;

        const data = [];
        for (let i = 0; i < limit; i++) {
            const t = startDate + i * interval;
            const dayFraction = (t % 86400000) / 86400000; // 0–1 through the day
            const seasonFraction = (t % (365 * 86400000)) / (365 * 86400000);

            // Outdoor temp: ~45–85°F with daily and seasonal variation
            const outdoorBase = 65 + Math.sin(seasonFraction * 2 * Math.PI) * 20;
            const dailySwing = Math.sin((dayFraction - 0.25) * 2 * Math.PI) * 12;
            const outdoor = outdoorBase + dailySwing + (Math.random() - 0.5);

            // Indoor temps: 68–75°F, more stable
            const indoorBase = 70 + Math.sin((dayFraction - 0.3) * 2 * Math.PI) * 3;

            const entry = {
                date: new Date(t).toISOString(),
                macAddress: macAddress || '00:00:00:00:00:00',
                temp1f: +(outdoor).toFixed(1),
                humidity1: +(50 + Math.sin(dayFraction * Math.PI) * 15 + Math.random() * 3).toFixed(1),
                batt1: 1,
                feelsLike1: +(outdoor - 2).toFixed(1),
                dewPoint1: +(outdoor - 15 + Math.random()).toFixed(1),
            };

            // Indoor sensors 2–8
            const offsets = [0, 1.5, -0.5, 2, -1, 0.8, -1.2];
            for (let j = 2; j <= 8; j++) {
                const offset = offsets[j - 2] || 0;
                entry[`temp${j}f`] = +(indoorBase + offset + (Math.random() - 0.5) * 0.5).toFixed(1);
                entry[`humidity${j}`] = +(45 + Math.random() * 5).toFixed(1);
                entry[`batt${j}`] = 1;
                entry[`feelsLike${j}`] = +(indoorBase + offset - 1).toFixed(1);
                entry[`dewPoint${j}`] = +(indoorBase + offset - 12).toFixed(1);
            }

            data.push(entry);
        }

        // AW API returns newest-first when limit is used without date range
        if (!options.startDate) data.reverse();
        return data;
    }
}

module.exports = MockAmbientWeatherApi;

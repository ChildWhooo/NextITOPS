# 地图数据说明

## 当前实现

- 默认底图是投影后的 **SVG**：`web/public/china-provinces.svg`，由省级 GeoJSON 边界投影生成，包含台湾地区、海南岛、南海诸岛及省级边界。
- SVG 本身是二维投影结果，**不包含经纬度字段**；数据中心经纬度来自 CI 模型中的 `latitude` / `longitude` 字段，前端用同一套 Mercator 参数叠加标记与线路。
- 地图设置支持上传替换 SVG，适合替换为内部审核过的标准地图。

## 如果需要城市级/街道级细节

仅靠一张国家 SVG 无法获得城市级细节。推荐以下方案：

1. **GeoJSON + Leaflet / MapLibre GL**（推荐，可离线部署）
   - 数据源：`Supeset/China-GeoData` 的 `china_province_full.geojson`、`china_city_full.geojson`，或 DataV GeoAtlas 的行政区 GeoJSON。
   - GeoJSON 的坐标是真实经纬度，交给 Leaflet/MapLibre 渲染，缩放、拖动和省市下钻都由地图引擎处理。
   - 可以继续使用本系统的 `latitude` / `longitude` 字段绘制数据中心和线路。
2. **高德 / 百度 JS API 或瓦片**
   - 需要申请 Key，适合需要 POI、道路和城市级底图的场景；国内合规审核由图源服务承担。
   - 本系统已提供高德瓦片图源入口，标准地图仍为默认。
3. **矢量瓦片**
   - 适合大量城市/区县数据和高频交互，需要额外的瓦片服务。

当前版本保留“标准 SVG + 经纬度叠加”的轻量方案；如果要升级为 Leaflet/MapLibre，数据层可以直接复用 GeoJSON，不需要改 CI 经纬度字段。

import { router } from "@/config/router";
import { useRoute, type RouteLocationPathRaw } from "vue-router";

export function useAppRouters() {
  const route = useRoute();

  const getRouteParamsUrl = () => {
    return route?.fullPath?.split("?")[1] || "";
  };

  const toPage = (params: RouteLocationPathRaw) => {
    const tmp = {
      ...params
    };
    // `route` can be undefined when toPage runs from a detached context (e.g. a
    // dialog embedded in the manage modal after it closes) — guard it so we don't
    // throw "Cannot read properties of undefined (reading 'query')".
    tmp.query = {
      ...(route?.query || {}),
      ...(params.query || {})
    };

    return router.push(tmp);
  };

  return {
    getRouteParamsUrl,
    toPage
  };
}

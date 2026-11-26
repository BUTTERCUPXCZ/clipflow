from fastapi import APIRouter, Request, Response

from app.services.health import HealthReport, HealthService

router = APIRouter()


@router.get("/health")
async def health(request: Request, response: Response) -> HealthReport:
    service: HealthService = request.app.state.health
    report = await service.report()
    if not report.healthy:
        response.status_code = 503
    return report

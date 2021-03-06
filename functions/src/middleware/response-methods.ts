import express from "express"

export default function (req: express.Request, res: express.Response, next: express.NextFunction) {

  res.error = (status: number, message: any) => {
    res.status(status).json({success: false, error: message});
    return res
  }

  res.success = (payload: string | object) => {
    if (typeof payload === "string") {
      res.json({success: true, message: payload});
    }
    else {
      (payload as any).success = true;
      res.json(payload)
    }
    return res
  }

  next()
}
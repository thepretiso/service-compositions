export type Main_Request = string
export type Main_Result = string

export class ServiceComposition {

    constructor(
        private a: ServiceA,
        private b: ServiceB,
        private c: ServiceC,
        private d: ServiceD,
        private e: ServiceE,
        private f: ServiceF,
        private errorMapper: ErrorMapper,
    ){}

    async run(req: Main_Request, timeoutMillis: number, cancellation: CancellationToken): Promise<Main_Result> {
        const errors: Error[] = [];
        let completed = false;
        let timeoutHandler: NodeJS.Timeout | undefined = undefined

        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandler = setTimeout(() => {
                completed = false
                reject(this.errorMapper.timedOut());
            }, timeoutMillis);
        });

        cancellation.onCancelled(() => {
            clearTimeout(timeoutHandler);
            throw this.errorMapper.aborted();
        })

        try {
            const tokenServiceA = this.a.start(req)
            const pollServiceA = async (): Promise<ServiceA_Result> => {
                while (!cancellation.isCancelled()) {
                    const result = this.a.poll(tokenServiceA);
                    if (result !== null) return result;
                }
                this.a.abort(tokenServiceA);
                throw this.errorMapper.aborted();
            };

            const serviceB = new Promise<ServiceB_Result>((resolve, reject) => {
                this.b.submit(
                    req,
                    () => cancellation.isCancelled(),
                    timeoutMillis,
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                )
            });

            const [resultA, resultB] = await Promise.race([
                timeoutPromise,
                Promise.all([pollServiceA(), serviceB])
            ]) as [ServiceA_Result, ServiceB_Result, ServiceC_Result];

            return this.d.merge(resultA, resultB)

            // TODO implement other paths
        } catch (err) {
            if (!completed && !cancellation.isCancelled()) {
                errors.push(err as Error);
                throw await this.errorMapper.error(errors);
            } else {
                throw err;
            }
        } finally {
            clearTimeout(timeoutHandler);
        }
    }
}

export type ServiceA_InvocationToken = string
export type ServiceA_Result = string
export interface ServiceA {
    start(req: Main_Request): ServiceA_InvocationToken;
	
	/**
	 * @param tok obtained from previous call to {@link #start}
	 * @return result of invocation identified by Token if it already finished and result has not been collected yet,
	 * 			or null if invocation has not finished yet or the result has already been collected.
	 */
	poll(tok: ServiceA_InvocationToken): ServiceA_Result | null;
    abort(tok: ServiceA_InvocationToken): void
}


export type ServiceB_Result = string
export interface ServiceB {

	/**
	 * @param timeout if result is not available within timeout will complete with error
	 * @param isCancelled the implementation may check this to see if caller is still interested in the result,
	 * 				     if this returns true will be completed by error early
	 * @param callback exactly one of Result or Error will be present
	 */
	submit(
        req: Main_Request,
        isCancelled: () => boolean,
        timeout: number,
        callback: (err: Error | undefined, result: ServiceB_Result) => void
    ): void;
}

export type ServiceC_Result = string
export interface ServiceC {

	call(req: Main_Request): Promise<ServiceC_Result>;
}

export interface ServiceD {

	/**
	 * @return may be completed exceptionally if merging fails
	 */
	merge(a: ServiceA_Result, b: ServiceB_Result): Promise<Main_Result>;
}

export type ServiceE_Result = string
export type ServiceE_CancelToken = () => void
export interface ServiceE {

    /**
     * 
     * @returns future for the result and callback that may be called to abort execution early,
     *          when aborted the future will be rejected by error
     */
	transform(b: Promise<ServiceB_Result>): [Promise<ServiceE_Result>, ServiceE_CancelToken];
    combine(a: Promise<ServiceA_Result>, c: Promise<ServiceC_Result>): [Promise<ServiceE_Result>, ServiceE_CancelToken];
}

export interface ServiceF {

    present(c: ServiceC_Result, e: ServiceE_Result): Main_Result;
}

export interface ErrorMapper {
    error(orig: Error[]): Promise<Error>
    timedOut(): Error
    aborted(): Error
}

export interface CancellationToken {
    isCancelled(): boolean
    onCancelled(listener: () => void): void
}

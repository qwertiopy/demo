// Soft operation budget used for profiling expensive but atomic work. A
// negative remaining value records overrun; it never truncates gameplay.

export class SoftOperationBudget {
	constructor(limit = 0) {
		this.reset(limit);
	}

	reset(limit = this.limit) {
		this.limit = Math.max(0, Math.floor(Number(limit) || 0));
		this.spent = 0;
		return this;
	}

	consume(units = 1) {
		const cost = Math.max(1, Math.floor(Number(units) || 1));
		this.spent += cost;
		return true;
	}

	get remaining() {
		return this.limit - this.spent;
	}

	get overrun() {
		return Math.max(0, this.spent - this.limit);
	}
}

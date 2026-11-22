import { Module } from '@nestjs/common';
import { TransferWorkflowService } from './transfer-workflow.service';

@Module({ providers: [TransferWorkflowService], exports: [TransferWorkflowService] })
export class WorkflowsModule {}

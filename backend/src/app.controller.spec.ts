import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const prismaMock = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService;

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('root', () => {
    it('should return the API info payload', () => {
      expect(appController.getApiInfo()).toMatchObject({
        name: 'Speakio API',
        status: 'ok',
      });
    });
  });

  describe('health', () => {
    it('should report ok when the database is reachable', async () => {
      const report = await appService.getHealth();
      expect(report).toMatchObject({ status: 'ok', database: 'up' });
    });
  });
});

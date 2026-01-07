#import "ObjCExceptionCatcher.h"

@implementation ObjCExceptionCatcher

+ (BOOL)tryBlock:(void(NS_NOESCAPE ^)(void))tryBlock error:(NSError *_Nullable *_Nullable)error {
    @try {
        tryBlock();
        return YES;
    }
    @catch (NSException *exception) {
        if (error) {
            *error = [NSError errorWithDomain:@"ObjCException"
                                         code:0
                                     userInfo:@{
                NSLocalizedDescriptionKey: exception.reason ?: @"Unknown exception",
                @"ExceptionName": exception.name ?: @"Unknown"
            }];
        }
        return NO;
    }
}

@end
